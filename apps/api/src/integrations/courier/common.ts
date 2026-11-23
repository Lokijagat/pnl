import { Types, type AnyBulkWriteOperation } from "mongoose";
import { isRtoStatus, type DeliveryStatus, type PaymentMode } from "@pnl/shared";
import { Shipment, effectiveCharges } from "../../models/Shipment";
import { Order } from "../../models/Order";
import { applyCosts, buildCostResolver, tenantPackingPerOrder, type CostableOrder } from "../../services/costing";

export interface Charges {
  freight: number;
  cod: number;
  rto: number;
  reverse: number;
  weightDiscrepancy: number;
  other: number;
  gst: number;
  total: number;
}

/** Har courier adapter isi format mein shipment deta hai (amounts paise) */
export interface NormalizedShipment {
  externalId: string;
  awb?: string;
  courierName?: string;
  orderRef?: string;
  paymentMode?: PaymentMode;
  codAmount?: number;
  isReverse?: boolean;
  status: DeliveryStatus;
  statusRaw?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  rtoInitiatedAt?: Date;
  rtoDeliveredAt?: Date;
  lastStatusAt?: Date;
  weightGrams?: number;
  chargedWeightGrams?: number;
  zone?: string;
  pickupPincode?: string;
  pincode?: string;
  city?: string;
  state?: string;
  /** raw component amounts (paise), GST include/exclude config ke hisaab se finalize hote hain */
  charges?: Partial<Omit<Charges, "gst" | "total">>;
  chargesSource?: "api" | "estimate" | "invoice" | "none";
  raw?: unknown;
}

export const GST_RATE = 0.18;
const COMPONENTS = ["freight", "cod", "rto", "reverse", "weightDiscrepancy", "other"] as const;

/** Components ko ex-GST mein convert karke GST + total nikaalo */
export function finalizeCharges(parts: Partial<Omit<Charges, "gst" | "total">> = {}, includesGst = false, gstOverride?: number): Charges {
  const out: Charges = { freight: 0, cod: 0, rto: 0, reverse: 0, weightDiscrepancy: 0, other: 0, gst: 0, total: 0 };
  for (const k of COMPONENTS) {
    const v = Math.max(0, Math.round(parts[k] ?? 0));
    out[k] = includesGst ? Math.round(v / (1 + GST_RATE)) : v;
  }
  out.total = COMPONENTS.reduce((s, k) => s + out[k], 0);
  out.gst = gstOverride ?? Math.round(out.total * GST_RATE);
  return out;
}

/** "#1001", "1001", Shopify numeric id — sab try karo */
function refCandidates(ref?: string) {
  if (!ref) return { names: [] as string[], gids: [] as string[] };
  const clean = ref.trim().replace(/^#/, "");
  return { names: [`#${clean}`, clean], gids: /^\d{6,}$/.test(clean) ? [`gid://shopify/Order/${clean}`] : [] };
}

export interface UpsertContext {
  tenantId: string;
  integrationId?: string;
  provider: string;
  includesGst: boolean;
}

/** Shipments save karo (invoice charges ko overwrite nahi karte), match + rollup */
export async function upsertShipments(ctx: UpsertContext, list: NormalizedShipment[]) {
  if (!list.length) return { upserted: 0, matched: 0 };
  const tenantId = new Types.ObjectId(ctx.tenantId);
  const ops: AnyBulkWriteOperation[] = list.map((s) => {
    const { charges, raw, ...rest } = s;
    const set: Record<string, unknown> = {
      ...rest,
      integrationId: ctx.integrationId ? new Types.ObjectId(ctx.integrationId) : undefined,
      raw,
    };
    // API ne charges nahi diye to purane (e.g. estimate) mat mitao
    if (s.chargesSource && s.chargesSource !== "none") set.charges = finalizeCharges(charges, ctx.includesGst);
    else delete set.chargesSource;
    for (const k of Object.keys(set)) if (set[k] === undefined) delete set[k];
    return {
      updateOne: {
        filter: { tenantId, provider: ctx.provider, externalId: s.externalId },
        update: { $set: set, $setOnInsert: { tenantId, provider: ctx.provider, externalId: s.externalId } },
        upsert: true,
      },
    };
  });
  // $set aur $setOnInsert mein same keys conflict karte hain
  for (const op of ops as { updateOne: { update: { $set: Record<string, unknown> } } }[]) {
    delete op.updateOne.update.$set.externalId;
  }
  await Shipment.bulkWrite(ops as never);

  const saved = await Shipment.find(
    { tenantId, provider: ctx.provider, externalId: { $in: list.map((s) => s.externalId) } },
    { _id: 1, orderId: 1 },
  ).lean();
  const matched = await matchShipments(ctx.tenantId, saved.filter((s) => !s.orderId).map((s) => s._id as Types.ObjectId));
  const orderIds = saved.map((s) => s.orderId).filter(Boolean).map(String);
  await rollupOrders(ctx.tenantId, [...new Set([...orderIds, ...matched])]);
  return { upserted: list.length, matched: matched.length };
}

/**
 * Shipment ↔ Shopify order matching:
 * 1) AWB = Shopify fulfillment tracking number  2) courier ka order ref = Shopify order name/id
 * Returns matched orderIds.
 */
export async function matchShipments(tenantId: string, shipmentIds?: Types.ObjectId[]) {
  const filter: Record<string, unknown> = { tenantId: new Types.ObjectId(tenantId), orderId: null };
  if (shipmentIds) {
    if (!shipmentIds.length) return [];
    filter._id = { $in: shipmentIds };
  }
  const unmatched = await Shipment.find(filter, { awb: 1, orderRef: 1 }).limit(5000).lean();
  if (!unmatched.length) return [];

  const awbs = unmatched.map((s) => s.awb).filter(Boolean) as string[];
  const names = unmatched.flatMap((s) => refCandidates(s.orderRef ?? undefined).names);
  const gids = unmatched.flatMap((s) => refCandidates(s.orderRef ?? undefined).gids);
  const orders = await Order.find(
    { tenantId, $or: [{ "fulfillments.number": { $in: awbs } }, { name: { $in: names } }, { shopifyId: { $in: gids } }] },
    { name: 1, shopifyId: 1, processedAt: 1, paymentMode: 1, "fulfillments.number": 1, shipping: 1 },
  ).lean();

  const byAwb = new Map<string, (typeof orders)[number]>();
  const byName = new Map<string, (typeof orders)[number]>();
  for (const o of orders) {
    for (const f of o.fulfillments ?? []) if (f.number) byAwb.set(f.number, o);
    byName.set(o.name, o);
    byName.set(o.shopifyId, o);
  }

  const ops: AnyBulkWriteOperation[] = [];
  const matchedOrderIds: string[] = [];
  for (const s of unmatched) {
    const c = refCandidates(s.orderRef ?? undefined);
    const o =
      (s.awb ? byAwb.get(s.awb) : undefined) ??
      c.names.map((n) => byName.get(n)).find(Boolean) ??
      c.gids.map((g) => byName.get(g)).find(Boolean);
    if (!o) continue;
    matchedOrderIds.push(String(o._id));
    ops.push({
      updateOne: {
        filter: { _id: s._id },
        update: { $set: { orderId: o._id, orderName: o.name, orderDate: o.processedAt } },
      },
    });
    // Courier ne payment/state/pincode nahi diya to order se bharo (courier data overwrite nahi hota)
    ops.push({ updateOne: { filter: { _id: s._id, paymentMode: null }, update: { $set: { paymentMode: o.paymentMode } } } });
    if (o.shipping?.state) ops.push({ updateOne: { filter: { _id: s._id, state: null }, update: { $set: { state: o.shipping.state } } } });
    if (o.shipping?.pincode) ops.push({ updateOne: { filter: { _id: s._id, pincode: null }, update: { $set: { pincode: o.shipping.pincode } } } });
  }
  if (ops.length) await Shipment.bulkWrite(ops as never);
  return matchedOrderIds;
}

const FINAL_FORWARD_ORDER: DeliveryStatus[] = ["rto_delivered", "delivered", "rto_in_transit", "rto_initiated", "lost"];

/** Orders par shipping cost, status, RTO flag aur CM2 update karo */
export async function rollupOrders(tenantId: string, orderIds: string[]) {
  if (!orderIds.length) return;
  const ids = orderIds.map((id) => new Types.ObjectId(id));
  const [orders, shipments, packingPerOrder] = await Promise.all([
    Order.find({ _id: { $in: ids }, tenantId }).lean(),
    Shipment.find({ tenantId, orderId: { $in: ids } }).lean(),
    tenantPackingPerOrder(tenantId),
  ]);
  const byOrder = new Map<string, typeof shipments>();
  for (const s of shipments) {
    const k = String(s.orderId);
    byOrder.set(k, [...(byOrder.get(k) ?? []), s]);
  }
  const resolve = await buildCostResolver(
    tenantId,
    orders.flatMap((o) => o.lineItems.map((l) => (l.variantId ? String(l.variantId) : ""))).filter(Boolean),
  );

  const ops = orders.map((o) => {
    const list = byOrder.get(String(o._id)) ?? [];
    let cost = 0;
    let gst = 0;
    for (const s of list) {
      const ch = effectiveCharges(s);
      cost += ch?.total ?? 0;
      gst += ch?.gst ?? 0;
    }
    const forward = list.filter((s) => !s.isReverse && s.status !== "cancelled");
    // sabse "aage" wala status (RTO delivered > delivered > ...), warna latest
    const primary =
      FINAL_FORWARD_ORDER.map((st) => forward.find((s) => s.status === st)).find(Boolean) ??
      [...forward].sort((a, b) => +(b.lastStatusAt ?? b.updatedAt ?? 0) - +(a.lastStatusAt ?? a.updatedAt ?? 0))[0];
    const isRto = forward.some((s) => isRtoStatus(s.status));

    const doc = { ...o, shippingCost: cost, isRto } as unknown as CostableOrder;
    applyCosts(doc, resolve, packingPerOrder);
    return {
      updateOne: {
        filter: { _id: o._id },
        update: {
          $set: {
            shippingCost: cost,
            shippingGst: gst,
            shipmentCount: list.length,
            courier: primary?.courierName ?? undefined,
            awb: primary?.awb ?? undefined,
            deliveryStatus: primary?.status ?? undefined,
            isRto,
            lineItems: doc.lineItems,
            netRevenue: doc.netRevenue,
            cogs: doc.cogs,
            packing: doc.packing,
            grossProfit: doc.grossProfit,
            cm2: doc.cm2,
            cm3: doc.cm3,
          },
        },
      },
    };
  });
  if (ops.length) await Order.bulkWrite(ops as never);
}

// ───────── date helpers ─────────
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Courier dates (IST): "2026-11-21 11:20:00", "2026-11-21T11:20:00", "21 Nov 2026, 11:20 AM", "21-11-2026", ISO with zone.
 */
export function parseIstDate(v: unknown): Date | undefined {
  if (v == null || v === "") return undefined;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (!s || /^0{4}/.test(s)) return undefined;
  // already has timezone
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(+d) ? undefined : d;
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}+05:30`);
    return isNaN(+d) ? undefined : d;
  }
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}T${(m[4] ?? "0").padStart(2, "0")}:${m[5] ?? "00"}:00+05:30`);
    return isNaN(+d) ? undefined : d;
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*,?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?/);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase()];
    if (mon === undefined) return undefined;
    let h = Number(m[4] ?? 0);
    const ap = m[6]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    const iso = `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}T${String(h).padStart(2, "0")}:${m[5] ?? "00"}:00+05:30`;
    const d = new Date(iso);
    return isNaN(+d) ? undefined : d;
  }
  const d = new Date(s);
  return isNaN(+d) ? undefined : d;
}

/** "1.5" kg / 1500 g → grams */
export function kgToGrams(v: unknown): number | undefined {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 1000);
}
