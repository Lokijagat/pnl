import { Types, type AnyBulkWriteOperation } from "mongoose";
import { moneyToPaise } from "@pnl/shared";
import { ShopifyClient } from "./client";
import {
  PRODUCTS_QUERY,
  PRODUCT_BY_ID,
  SHOP_QUERY,
  WEBHOOKS_LIST,
  WEBHOOK_CREATE,
  WEBHOOK_DELETE,
  orderByIdQuery,
  ordersQuery,
  type GqlOrder,
  type GqlProduct,
} from "./queries";
import { mapOrder } from "./mapper";
import { Product, Variant } from "../../models/Product";
import { Order } from "../../models/Order";
import { Tenant } from "../../models/Tenant";
import { Integration } from "../../models/Integration";
import { applyCosts, buildCostResolver } from "../../services/costing";
import { loadIntegration, updateIntegrationMeta, type LoadedIntegration } from "../../services/integrationCreds";
import { env } from "../../config/env";

export const REQUIRED_SCOPES = ["read_orders", "read_products"];
export const OPTIONAL_SCOPES = ["read_all_orders", "read_inventory", "read_customers"];

export const WEBHOOK_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "REFUNDS_CREATE",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "APP_UNINSTALLED",
] as const;

const hasScope = (integ: LoadedIntegration, s: string) => ((integ.meta.scopes as string[] | undefined) ?? []).includes(s);

// ───────────── Test connection ─────────────
export async function testShopify(integrationId: string, tenantId: string) {
  const integ = await loadIntegration(integrationId, tenantId);
  try {
    const client = new ShopifyClient(integ);
    const data = await client.gql<{
      shop: { name: string; myshopifyDomain: string; currencyCode: string; ianaTimezone: string; plan: { displayName: string } };
      currentAppInstallation: { accessScopes: { handle: string }[] };
    }>(SHOP_QUERY);
    const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
    const missingRequired = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
    const missingOptional = OPTIONAL_SCOPES.filter((s) => !scopes.includes(s));
    const ok = missingRequired.length === 0;
    await updateIntegrationMeta(
      integrationId,
      {
        shopName: data.shop.name,
        myshopifyDomain: data.shop.myshopifyDomain,
        currency: data.shop.currencyCode,
        timezone: data.shop.ianaTimezone,
        plan: data.shop.plan.displayName,
        scopes,
      },
      { status: ok ? "connected" : "error", lastError: ok ? null : `Missing scopes: ${missingRequired.join(", ")}` },
    );
    return { ok, shop: data.shop, scopes, missingRequired, missingOptional };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await Integration.updateOne({ _id: integrationId }, { status: "error", lastError: msg });
    return { ok: false, error: msg };
  }
}

// ───────────── Products ─────────────
async function upsertProducts(integ: LoadedIntegration, products: GqlProduct[]) {
  if (!products.length) return;
  const tenantId = new Types.ObjectId(integ.tenantId);
  const integrationId = new Types.ObjectId(integ.id);

  await Product.bulkWrite(
    products.map((p) => ({
      updateOne: {
        filter: { integrationId, shopifyId: p.id },
        update: {
          $set: {
            tenantId,
            title: p.title,
            status: p.status,
            vendor: p.vendor ?? undefined,
            productType: p.productType ?? undefined,
            imageUrl: p.featuredMedia?.preview?.image?.url ?? undefined,
          },
        },
        upsert: true,
      },
    })),
  );
  const saved = await Product.find({ integrationId, shopifyId: { $in: products.map((p) => p.id) } }, { shopifyId: 1 }).lean();
  const pid = new Map(saved.map((p) => [p.shopifyId, p._id]));

  const ops: AnyBulkWriteOperation[] = [];
  for (const p of products) {
    for (const v of p.variants.nodes) {
      const unitCost = v.inventoryItem?.unitCost?.amount;
      ops.push({
        updateOne: {
          filter: { integrationId, shopifyId: v.id },
          update: {
            $set: {
              tenantId,
              productId: pid.get(p.id),
              sku: v.sku ?? "",
              title: v.title,
              price: moneyToPaise(v.price),
              shopifyUnitCost: unitCost != null ? moneyToPaise(unitCost) : undefined,
              deleted: false,
            },
          },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await Variant.bulkWrite(ops as never);
}

export async function syncProducts(integrationId: string, onProgress: (n: number) => Promise<void>) {
  const integ = await loadIntegration(integrationId);
  const client = new ShopifyClient(integ);
  let cursor: string | null = null;
  let count = 0;
  for (;;) {
    const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlProduct[] } } =
      await client.gql(PRODUCTS_QUERY, { cursor });
    await upsertProducts(integ, data.products.nodes);
    count += data.products.nodes.length;
    await onProgress(count);
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  await updateIntegrationMeta(integrationId, { productsSyncedAt: new Date() });
  return count;
}

export async function refreshProduct(integrationId: string, gid: string) {
  const integ = await loadIntegration(integrationId);
  const client = new ShopifyClient(integ);
  const data = await client.gql<{ product: GqlProduct | null }>(PRODUCT_BY_ID, { id: gid });
  if (data.product) await upsertProducts(integ, [data.product]);
}

export async function markProductDeleted(integrationId: string, gid: string) {
  const p = await Product.findOneAndUpdate({ integrationId, shopifyId: gid }, { status: "DELETED" });
  if (p) await Variant.updateMany({ productId: p._id }, { deleted: true });
}

// ───────────── Orders ─────────────
async function upsertOrders(integ: LoadedIntegration, orders: GqlOrder[]) {
  if (!orders.length) return;
  const integrationId = new Types.ObjectId(integ.id);

  const variantGids = [...new Set(orders.flatMap((o) => o.lineItems.nodes.map((l) => l.variant?.id).filter(Boolean) as string[]))];
  const variants = await Variant.find({ integrationId, shopifyId: { $in: variantGids } }, { shopifyId: 1 }).lean();
  const vmap = new Map(variants.map((v) => [v.shopifyId, v._id as Types.ObjectId]));

  const tenant = await Tenant.findById(integ.tenantId, { settings: 1 }).lean();
  const packingPerOrder = tenant?.settings?.packingPerOrder ?? 0;
  const resolve = await buildCostResolver(integ.tenantId, variants.map((v) => String(v._id)));

  // Courier se aaye shipping fields preserve karo (Shopify inhe nahi jaanta)
  const existing = await Order.find(
    { integrationId, shopifyId: { $in: orders.map((o) => o.id) } },
    { shopifyId: 1, isRto: 1, shippingCost: 1, marketingCost: 1 },
  ).lean();
  const ship = new Map(existing.map((e) => [e.shopifyId, e]));

  const ops = orders.map((o) => {
    const prev = ship.get(o.id);
    const doc = { ...mapOrder(o, integ.tenantId, integ.id, vmap), isRto: prev?.isRto ?? false, shippingCost: prev?.shippingCost ?? 0, marketingCost: prev?.marketingCost ?? 0 };
    applyCosts(doc, resolve, packingPerOrder);
    return { updateOne: { filter: { integrationId, shopifyId: o.id }, update: { $set: doc }, upsert: true } };
  });
  await Order.bulkWrite(ops as never);
}

/**
 * Pehli baar: created_at >= (aaj − syncDays). Uske baad: updated_at >= last synced (incremental).
 * UPDATED_AT asc sort → beech mein fail ho to wahin se resume.
 */
export async function syncOrders(integrationId: string, onProgress: (n: number) => Promise<void>, opts: { full?: boolean } = {}) {
  const integ = await loadIntegration(integrationId);
  const client = new ShopifyClient(integ);
  const tenant = await Tenant.findById(integ.tenantId, { settings: 1 }).lean();
  const syncDays = tenant?.settings?.syncDays ?? 365;

  const since = opts.full ? undefined : (integ.meta.ordersSyncedUntil as string | Date | undefined);
  const search = since
    ? `updated_at:>='${new Date(new Date(since).getTime() - 5 * 60_000).toISOString()}'`
    : `created_at:>='${new Date(Date.now() - syncDays * 86_400_000).toISOString()}'`;

  const query = ordersQuery(hasScope(integ, "read_customers"));
  let cursor: string | null = null;
  let count = 0;
  for (;;) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlOrder[] } } =
      await client.gql(query, { cursor, query: search });
    const nodes = data.orders.nodes;
    await upsertOrders(integ, nodes);
    count += nodes.length;
    const last = nodes[nodes.length - 1];
    if (last) await updateIntegrationMeta(integrationId, { ordersSyncedUntil: new Date(last.updatedAt) });
    await onProgress(count);
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  await Integration.updateOne({ _id: integrationId }, { lastSyncAt: new Date() });
  return count;
}

export async function refreshOrder(integrationId: string, gid: string) {
  const integ = await loadIntegration(integrationId);
  const client = new ShopifyClient(integ);
  const data = await client.gql<{ order: GqlOrder | null }>(orderByIdQuery(hasScope(integ, "read_customers")), { id: gid });
  if (data.order) await upsertOrders(integ, [data.order]);
}

// ───────────── Webhooks ─────────────
export function shopifyWebhookUrl(webhookKey: string) {
  return `${env.PUBLIC_API_URL}/api/webhooks/shopify/${webhookKey}`;
}

export async function registerWebhooks(integrationId: string, tenantId: string) {
  if (/localhost|127\.0\.0\.1/.test(env.PUBLIC_API_URL)) {
    return {
      ok: false,
      error: "PUBLIC_API_URL localhost hai — Shopify localhost par webhook nahi bhej sakta. cloudflared/ngrok URL set karo.",
    };
  }
  const integ = await loadIntegration(integrationId, tenantId);
  if (!integ.secrets.apiSecretKey) {
    return { ok: false, error: "API secret key save nahi hai — webhook verify ke liye zaroori hai" };
  }
  const doc = await Integration.findById(integrationId, { webhookKey: 1 }).lean();
  const url = shopifyWebhookUrl(doc!.webhookKey);
  const client = new ShopifyClient(integ);

  const existing = await client.gql<{
    webhookSubscriptions: { nodes: { id: string; topic: string; endpoint: { callbackUrl?: string } }[] };
  }>(WEBHOOKS_LIST);

  // hamare purane URLs (key/domain badla ho) hata do
  for (const w of existing.webhookSubscriptions.nodes) {
    const cb = w.endpoint.callbackUrl ?? "";
    if (cb.includes("/api/webhooks/shopify/") && cb !== url) await client.gql(WEBHOOK_DELETE, { id: w.id });
  }
  const have = new Set(existing.webhookSubscriptions.nodes.filter((w) => w.endpoint.callbackUrl === url).map((w) => w.topic));

  const errors: string[] = [];
  const created: string[] = [];
  for (const topic of WEBHOOK_TOPICS) {
    if (have.has(topic)) continue;
    const r = await client.gql<{ webhookSubscriptionCreate: { userErrors: { message: string }[] } }>(WEBHOOK_CREATE, { topic, url });
    const ue = r.webhookSubscriptionCreate.userErrors;
    if (ue.length) errors.push(`${topic}: ${ue.map((e) => e.message).join(", ")}`);
    else created.push(topic);
  }
  await updateIntegrationMeta(integrationId, { webhooksRegisteredAt: new Date(), webhookTopics: [...have, ...created] });
  return { ok: errors.length === 0, created, alreadyRegistered: [...have], errors };
}
