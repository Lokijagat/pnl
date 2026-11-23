/**
 * Marketing cost engine.
 * Har din (IST) ka marketing cost = Meta spend + Google spend + team commission + team fixed salary (din ka hissa).
 * Per-order marketing = us din ka cost ÷ us din ke orders (cancelled chhod ke).
 * Commission eligible orders = cancelled aur RTO chhod ke.
 */
import { Types } from "mongoose";
import { AdSpend } from "../models/AdSpend";
import { Order } from "../models/Order";
import { MarketingMember } from "../models/MarketingMember";
import { istDate, istEndOfDay } from "./costing";

const TZ = "Asia/Kolkata";

type Bucket = { count: number; revenue: number; cm2: number };
const empty = (): Bucket => ({ count: 0, revenue: 0, cm2: 0 });

export interface MemberDay {
  memberId: string;
  commission: number;
  fixed: number;
}

export interface DayData {
  day: string;
  metaSpend: number;
  googleSpend: number;
  adGst: number;
  purchases: number;
  purchaseValue: number;
  /** non-cancelled orders */
  orders: number;
  netRevenue: number;
  cm2: number;
  /** commission-eligible (non-cancelled, non-RTO) by UTM channel scope */
  eligible: { all: Bucket; meta: Bucket; google: Bucket };
  /** non-cancelled orders by channel (meta/google/other/direct) */
  channels: Record<string, Bucket>;
  members: MemberDay[];
  commission: number;
  fixed: number;
  adSpend: number;
  total: number;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const daysInMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export async function computeDaily(tenantId: string, from: string, to: string): Promise<Map<string, DayData>> {
  const tid = new Types.ObjectId(tenantId);
  const range = { $gte: istDate(from), $lte: istEndOfDay(to) };

  const [ads, orderAgg, members] = await Promise.all([
    AdSpend.aggregate<{ _id: { day: string; platform: string }; spend: number; gst: number; purchases: number; purchaseValue: number }>([
      { $match: { tenantId: tid, day: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { day: "$day", platform: "$platform" },
          spend: { $sum: "$spend" },
          gst: { $sum: "$gst" },
          purchases: { $sum: "$purchases" },
          purchaseValue: { $sum: "$purchaseValue" },
        },
      },
    ]),
    Order.aggregate<{ _id: { day: string; channel: string | null; rto: boolean }; count: number; revenue: number; cm2: number }>([
      { $match: { tenantId: tid, processedAt: range, status: { $ne: "cancelled" } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { date: "$processedAt", format: "%Y-%m-%d", timezone: TZ } },
            channel: "$utm.channel",
            rto: { $ifNull: ["$isRto", false] },
          },
          count: { $sum: 1 },
          revenue: { $sum: "$netRevenue" },
          cm2: { $sum: "$cm2" },
        },
      },
    ]),
    MarketingMember.find({ tenantId: tid, active: true }).lean(),
  ]);

  const map = new Map<string, DayData>();
  for (const day of eachDay(from, to)) {
    map.set(day, {
      day, metaSpend: 0, googleSpend: 0, adGst: 0, purchases: 0, purchaseValue: 0, orders: 0, netRevenue: 0, cm2: 0,
      eligible: { all: empty(), meta: empty(), google: empty() }, channels: {}, members: [], commission: 0, fixed: 0, adSpend: 0, total: 0,
    });
  }

  for (const a of ads) {
    const d = map.get(a._id.day);
    if (!d) continue;
    if (a._id.platform === "meta") d.metaSpend += a.spend;
    else d.googleSpend += a.spend;
    d.adGst += a.gst;
    d.purchases += a.purchases;
    d.purchaseValue += a.purchaseValue;
  }

  for (const o of orderAgg) {
    const d = map.get(o._id.day);
    if (!d) continue;
    const ch = o._id.channel ?? "direct";
    d.orders += o.count;
    d.netRevenue += o.revenue;
    d.cm2 += o.cm2;
    const c = (d.channels[ch] ??= empty());
    c.count += o.count;
    c.revenue += o.revenue;
    c.cm2 += o.cm2;
    if (!o._id.rto) {
      for (const k of ["all", ...(ch === "meta" || ch === "google" ? [ch] : [])] as ("all" | "meta" | "google")[]) {
        d.eligible[k].count += o.count;
        d.eligible[k].revenue += o.revenue;
        d.eligible[k].cm2 += o.cm2;
      }
    }
  }

  for (const d of map.values()) {
    d.adSpend = d.metaSpend + d.googleSpend;
    for (const m of members) {
      const start = m.startDate ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(m.startDate) : null;
      if (start && d.day < start) continue;
      const scope = d.eligible[(m.orderScope ?? "all") as "all" | "meta" | "google"];
      const rate = (m.commissionValue ?? 0) / 10000; // basis points → fraction
      const platformSpend = (m.platforms ?? []).reduce((s, p) => s + (p === "meta" ? d.metaSpend : p === "google" ? d.googleSpend : 0), 0);
      let commission = 0;
      switch (m.commissionType) {
        case "per_order":
          commission = (m.commissionValue ?? 0) * scope.count; // paise × orders
          break;
        case "percent_revenue":
          commission = rate * scope.revenue;
          break;
        case "percent_ad_spend":
          commission = rate * platformSpend;
          break;
        case "percent_profit":
          commission = rate * Math.max(0, scope.cm2);
          break;
      }
      const fixed = (m.monthlyFixed ?? 0) / daysInMonth(d.day);
      if (commission || fixed) d.members.push({ memberId: String(m._id), commission: Math.round(commission), fixed: Math.round(fixed) });
    }
    d.commission = d.members.reduce((s, x) => s + x.commission, 0);
    d.fixed = d.members.reduce((s, x) => s + x.fixed, 0);
    d.total = d.adSpend + d.commission + d.fixed;
  }
  return map;
}

/** Orders par marketingCost + CM3 likho (din-wise barabar hissa) */
export async function allocateMarketing(tenantId: string, from: string, to: string, onProgress?: (n: number) => Promise<void>) {
  const tid = new Types.ObjectId(tenantId);
  const daily = await computeDaily(tenantId, from, to);
  let n = 0;
  let unallocated = 0;
  for (const d of daily.values()) {
    const range = { $gte: istDate(d.day), $lte: istEndOfDay(d.day) };
    const per = d.orders > 0 ? Math.round(d.total / d.orders) : 0;
    if (d.orders === 0) unallocated += d.total;
    await Order.updateMany({ tenantId: tid, processedAt: range, status: { $ne: "cancelled" } }, [
      { $set: { marketingCost: per, cm3: { $subtract: [{ $ifNull: ["$cm2", 0] }, per] } } },
    ]);
    await Order.updateMany({ tenantId: tid, processedAt: range, status: "cancelled" }, [
      { $set: { marketingCost: 0, cm3: { $ifNull: ["$cm2", 0] } } },
    ]);
    n++;
    if (n % 30 === 0) await onProgress?.(n);
  }
  return { days: n, unallocated };
}
