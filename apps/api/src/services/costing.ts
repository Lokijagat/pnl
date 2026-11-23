import { Types } from "mongoose";
import { CostHistory, Variant } from "../models/Product";
import { Order } from "../models/Order";
import { Tenant } from "../models/Tenant";

/** "2026-04-01" → us din 00:00 IST */
export function istDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+05:30`);
}
/** "2026-04-30" → us din 23:59:59.999 IST */
export function istEndOfDay(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

export interface CostAt {
  cogs: number;
  packing: number;
  missing: boolean;
}
export type CostResolver = (variantId: string | undefined, at: Date) => CostAt;

/** Diye gaye variants ki cost history ek baar load karke, date-wise resolve karne wala function */
export async function buildCostResolver(tenantId: string, variantIds: string[]): Promise<CostResolver> {
  const ids = [...new Set(variantIds)].filter(Boolean).map((id) => new Types.ObjectId(id));
  const [histories, variants] = await Promise.all([
    CostHistory.find({ tenantId, variantId: { $in: ids } })
      .sort({ effectiveFrom: -1 })
      .lean(),
    Variant.find({ _id: { $in: ids } }, { shopifyUnitCost: 1 }).lean(),
  ]);

  const byVariant = new Map<string, { cogs: number; packing: number; from: number }[]>();
  for (const h of histories) {
    const k = String(h.variantId);
    const arr = byVariant.get(k) ?? [];
    arr.push({ cogs: h.cogs, packing: h.packing ?? 0, from: h.effectiveFrom.getTime() });
    byVariant.set(k, arr);
  }
  const shopifyCost = new Map(variants.map((v) => [String(v._id), v.shopifyUnitCost ?? undefined]));

  return (variantId, at) => {
    if (!variantId) return { cogs: 0, packing: 0, missing: true };
    const list = byVariant.get(variantId);
    const t = at.getTime();
    // list desc sorted: pehla jo order date se pehle effective ho
    const hit = list?.find((h) => h.from <= t) ?? list?.[list.length - 1]; // date se pehle kuch nahi to sabse purana
    if (hit) return { cogs: hit.cogs, packing: hit.packing, missing: false };
    const sc = shopifyCost.get(variantId);
    if (sc !== undefined && sc !== null) return { cogs: sc, packing: 0, missing: false };
    return { cogs: 0, packing: 0, missing: true };
  };
}

export interface CostableOrder {
  processedAt: Date;
  status: string;
  totalPrice: number;
  tax: number;
  refunded: number;
  lineItems: {
    variantId?: Types.ObjectId | string | null;
    quantity?: number | null;
    currentQuantity?: number | null;
    cogsUnit?: number;
    packingUnit?: number;
    costMissing?: boolean;
  }[];
  paymentMode?: string;
  isRto?: boolean;
  shippingCost?: number;
  marketingCost?: number;
  netRevenue?: number;
  cogs?: number;
  packing?: number;
  costMissing?: boolean;
  grossProfit?: number;
  cm2?: number;
  cm3?: number;
}

/**
 * Order ke cost snapshot + CM1 calculate karo (mutates).
 * - Cancelled: revenue/cost 0 (ship nahi hua).
 * - RTO: product wapas stock mein → COGS 0; packing + shipping ka loss rehta hai.
 *   COD RTO → revenue 0 (paisa aaya hi nahi). Prepaid RTO → Shopify refund ke hisaab se.
 * - COGS: currentQuantity (refund ke baad) par; packing: original quantity par (packing ho chuki thi).
 * - CM2 = CM1 − shipping (ex-GST)
 * - CM3 = CM2 − marketing share (Phase 4 allocation)
 */
export function applyCosts(order: CostableOrder, resolve: CostResolver, packingPerOrder: number) {
  let cogs = 0;
  let packing = 0;
  let missing = false;
  for (const li of order.lineItems) {
    const c = resolve(li.variantId ? String(li.variantId) : undefined, order.processedAt);
    li.cogsUnit = c.cogs;
    li.packingUnit = c.packing;
    li.costMissing = c.missing;
    if (c.missing) missing = true;
    cogs += c.cogs * (li.currentQuantity ?? li.quantity ?? 0);
    packing += c.packing * (li.quantity ?? 0);
  }

  const kept = Math.max(order.totalPrice - order.refunded, 0);
  const exTaxRatio = order.totalPrice > 0 ? (order.totalPrice - order.tax) / order.totalPrice : 0;
  const revenue = Math.round(kept * exTaxRatio);

  if (order.isRto) {
    order.netRevenue = order.paymentMode === "prepaid" ? revenue : 0;
    order.cogs = 0;
    order.packing = packing + packingPerOrder;
  } else if (order.status === "cancelled") {
    order.netRevenue = 0;
    order.cogs = 0;
    order.packing = 0;
  } else {
    order.netRevenue = revenue;
    order.cogs = cogs;
    order.packing = packing + packingPerOrder;
  }
  order.costMissing = missing;
  order.grossProfit = order.netRevenue - order.cogs - order.packing;
  order.cm2 = order.grossProfit - (order.shippingCost ?? 0);
  order.cm3 = order.cm2 - (order.marketingCost ?? 0);
}

export async function tenantPackingPerOrder(tenantId: string) {
  const t = await Tenant.findById(tenantId, { settings: 1 }).lean();
  return t?.settings?.packingPerOrder ?? 0;
}

/**
 * Cost badalne par purane orders recalculate karo.
 * variantIds khaali = saare orders (e.g. per-order packing badla).
 */
export async function recostOrders(
  tenantId: string,
  opts: { variantIds?: string[]; from?: Date },
  onProgress?: (n: number) => Promise<void>,
) {
  const packingPerOrder = await tenantPackingPerOrder(tenantId);
  const filter: Record<string, unknown> = { tenantId };
  if (opts.variantIds?.length) filter["lineItems.variantId"] = { $in: opts.variantIds.map((id) => new Types.ObjectId(id)) };
  if (opts.from) filter.processedAt = { $gte: opts.from };

  let processed = 0;
  let lastId: Types.ObjectId | null = null;
  const BATCH = 200;
  for (;;) {
    const page: CostableOrder[] & { _id: Types.ObjectId }[] = await Order.find(lastId ? { ...filter, _id: { $gt: lastId } } : filter)
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean();
    if (!page.length) break;

    const vids = page.flatMap((o) => o.lineItems.map((li) => (li.variantId ? String(li.variantId) : ""))).filter(Boolean);
    const resolve = await buildCostResolver(tenantId, vids);
    const ops = page.map((o) => {
      applyCosts(o, resolve, packingPerOrder);
      return {
        updateOne: {
          filter: { _id: (o as unknown as { _id: Types.ObjectId })._id },
          update: {
            $set: {
              lineItems: o.lineItems,
              netRevenue: o.netRevenue,
              cogs: o.cogs,
              packing: o.packing,
              costMissing: o.costMissing,
              grossProfit: o.grossProfit,
              cm2: o.cm2,
              cm3: o.cm3,
            },
          },
        },
      };
    });
    await Order.bulkWrite(ops as never);
    processed += page.length;
    lastId = (page[page.length - 1] as unknown as { _id: Types.ObjectId })._id;
    await onProgress?.(processed);
    if (page.length < BATCH) break;
  }
  return processed;
}
