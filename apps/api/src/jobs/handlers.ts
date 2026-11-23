import { NonRetryableError, enqueue, registerJob } from "./queue";
import {
  markProductDeleted,
  refreshOrder,
  refreshProduct,
  syncOrders,
  syncProducts,
} from "../integrations/shopify/sync";
import { recostOrders } from "../services/costing";
import { COURIER_ADAPTERS, syncCourier } from "../integrations/courier";
import { matchShipments, rollupOrders } from "../integrations/courier/common";
import { ADS_ADAPTERS, syncAds } from "../integrations/ads";
import { allocateMarketing } from "../services/marketing";
import { Integration } from "../models/Integration";
import { logger } from "../lib/logger";

/** Naye orders ke saath pehle se aaye (unmatched) courier shipments jodo */
async function linkShipments(tenantId: string) {
  const ids = await matchShipments(tenantId);
  await rollupOrders(tenantId, ids);
}

function need(v: string | undefined, name: string): string {
  if (!v) throw new NonRetryableError(`${name} missing`);
  return v;
}

export const JOB_TYPES = {
  shopifyFullSync: "shopify.full_sync",
  shopifyOrdersSync: "shopify.orders.sync",
  shopifyOrderRefresh: "shopify.order.refresh",
  shopifyProductRefresh: "shopify.product.refresh",
  shopifyProductDelete: "shopify.product.delete",
  ordersRecost: "orders.recost",
  courierSync: "courier.sync",
  courierRollup: "courier.rollup",
  shipmentsMatch: "shipments.match",
  adsSync: "ads.sync",
  marketingAllocate: "marketing.allocate",
} as const;

const ymdIST = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** Orders/shipping/ads badalne ke baad marketing share dobara (default last 45 din) */
export async function queueAllocation(tenantId: string, days = 45) {
  await enqueue(tenantId, JOB_TYPES.marketingAllocate, {
    payload: { from: ymdIST(new Date(Date.now() - (days - 1) * 86_400_000)), to: ymdIST(new Date()) },
    dedupe: true,
    delayMs: 5_000,
  });
}

export function registerAllJobs() {
  /** Products pehle (taaki orders ko variant + cost mile), phir orders */
  registerJob(JOB_TYPES.shopifyFullSync, async (ctx) => {
    const id = need(ctx.integrationId, "integrationId");
    const products = await syncProducts(id, (n) => ctx.progress(n, `Products: ${n}`));
    await syncOrders(id, (n) => ctx.progress(n, `Products: ${products} · Orders: ${n}`), { full: Boolean(ctx.payload.full) });
    await linkShipments(ctx.tenantId);
    await queueAllocation(ctx.tenantId, 365);
  });

  registerJob(JOB_TYPES.shopifyOrdersSync, async (ctx) => {
    const id = need(ctx.integrationId, "integrationId");
    const n = await syncOrders(id, (n) => ctx.progress(n, `Orders: ${n}`));
    if (n > 0) {
      await linkShipments(ctx.tenantId);
      await queueAllocation(ctx.tenantId);
    }
  });

  registerJob(JOB_TYPES.shopifyOrderRefresh, async (ctx) => {
    await refreshOrder(need(ctx.integrationId, "integrationId"), need(ctx.payload.gid as string, "gid"));
    await linkShipments(ctx.tenantId);
  });

  registerJob(JOB_TYPES.shopifyProductRefresh, async (ctx) => {
    await refreshProduct(need(ctx.integrationId, "integrationId"), need(ctx.payload.gid as string, "gid"));
  });

  registerJob(JOB_TYPES.shopifyProductDelete, async (ctx) => {
    await markProductDeleted(need(ctx.integrationId, "integrationId"), need(ctx.payload.gid as string, "gid"));
  });

  registerJob(JOB_TYPES.ordersRecost, async (ctx) => {
    const variantIds = (ctx.payload.variantIds as string[] | undefined) ?? undefined;
    const from = ctx.payload.from ? new Date(ctx.payload.from as string) : undefined;
    await recostOrders(ctx.tenantId, { variantIds, from }, (n) => ctx.progress(n, `Orders recalculated: ${n}`));
    // percent-of-profit commission profit par depend karta hai
    await queueAllocation(ctx.tenantId, 365);
  });

  registerJob(JOB_TYPES.courierSync, async (ctx) => {
    await syncCourier(need(ctx.integrationId, "integrationId"), (n, msg) => ctx.progress(n, msg), { full: Boolean(ctx.payload.full) });
    await queueAllocation(ctx.tenantId);
  });

  registerJob(JOB_TYPES.courierRollup, async (ctx) => {
    await rollupOrders(ctx.tenantId, (ctx.payload.orderIds as string[] | undefined) ?? []);
  });

  /** Naye Shopify orders aane par pehle se aaye (unmatched) shipments jodo */
  registerJob(JOB_TYPES.shipmentsMatch, async (ctx) => {
    await linkShipments(ctx.tenantId);
  });

  registerJob(JOB_TYPES.adsSync, async (ctx) => {
    const r = await syncAds(need(ctx.integrationId, "integrationId"), (n, msg) => ctx.progress(n, msg), { full: Boolean(ctx.payload.full) });
    await ctx.progress(r.rows, `Campaign-days: ${r.rows} · allocating ${r.since} → ${r.until}`);
    await allocateMarketing(ctx.tenantId, r.since, r.until);
    await ctx.progress(r.rows, `Campaign-days: ${r.rows} · marketing allocated`);
  });

  registerJob(JOB_TYPES.marketingAllocate, async (ctx) => {
    const from = String(ctx.payload.from);
    const to = String(ctx.payload.to);
    const r = await allocateMarketing(ctx.tenantId, from, to, (n) => ctx.progress(n, `Days: ${n}`));
    await ctx.progress(r.days, `Allocated ${r.days} days`);
  });
}

/** Webhook miss ho jaaye to bhi data aaye: har 30 min incremental sync */
export function startScheduler() {
  const run = async () => {
    try {
      const stale = new Date(Date.now() - 30 * 60_000);
      const list = await Integration.find(
        { provider: "shopify", status: "connected", $or: [{ lastSyncAt: { $lt: stale } }, { lastSyncAt: null }] },
        { tenantId: 1 },
      ).lean();
      for (const i of list) {
        await enqueue(String(i.tenantId), JOB_TYPES.shopifyOrdersSync, { integrationId: String(i._id), dedupe: true });
      }
      // Couriers: har 2 ghante (status + charges update)
      const courierStale = new Date(Date.now() - 2 * 3600_000);
      const couriers = await Integration.find(
        { category: "shipping", provider: { $in: Object.keys(COURIER_ADAPTERS) }, status: "connected", $or: [{ lastSyncAt: { $lt: courierStale } }, { lastSyncAt: null }] },
        { tenantId: 1 },
      ).lean();
      for (const c of couriers) {
        await enqueue(String(c.tenantId), JOB_TYPES.courierSync, { integrationId: String(c._id), dedupe: true });
      }
      // Ads: har 3 ghante (last 7 din re-sync + allocation)
      const adsStale = new Date(Date.now() - 3 * 3600_000);
      const ads = await Integration.find(
        { provider: { $in: Object.keys(ADS_ADAPTERS) }, status: "connected", $or: [{ lastSyncAt: { $lt: adsStale } }, { lastSyncAt: null }] },
        { tenantId: 1 },
      ).lean();
      for (const a of ads) {
        await enqueue(String(a.tenantId), JOB_TYPES.adsSync, { integrationId: String(a._id), dedupe: true });
      }
    } catch (err) {
      logger.error({ err }, "scheduler error");
    }
  };
  setInterval(() => void run(), 10 * 60_000);
}
