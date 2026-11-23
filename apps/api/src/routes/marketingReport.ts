import { Router } from "express";
import { Types } from "mongoose";
import { marketingReportQuerySchema } from "@pnl/shared";
import { AdSpend } from "../models/AdSpend";
import { MarketingMember } from "../models/MarketingMember";
import { authOf, requireAuth } from "../middleware/auth";
import { computeDaily, type DayData } from "../services/marketing";

export const marketingReportRouter = Router();
marketingReportRouter.use(requireAuth);

const rs = (p: number) => Math.round(p) / 100;
const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** YYYY-MM-DD → period start */
function periodKey(day: string, g: "day" | "week" | "month") {
  if (g === "day") return day;
  if (g === "month") return day.slice(0, 8) + "01";
  const t = Date.parse(day + "T00:00:00Z");
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

interface Acc {
  metaSpend: number;
  googleSpend: number;
  adGst: number;
  commission: number;
  fixed: number;
  total: number;
  orders: number;
  netRevenue: number;
  cm2: number;
  purchases: number;
  purchaseValue: number;
  metaOrders: number;
  googleOrders: number;
  unallocated: number;
}
const zero = (): Acc => ({ metaSpend: 0, googleSpend: 0, adGst: 0, commission: 0, fixed: 0, total: 0, orders: 0, netRevenue: 0, cm2: 0, purchases: 0, purchaseValue: 0, metaOrders: 0, googleOrders: 0, unallocated: 0 });

function add(a: Acc, d: DayData) {
  a.metaSpend += d.metaSpend;
  a.googleSpend += d.googleSpend;
  a.adGst += d.adGst;
  a.commission += d.commission;
  a.fixed += d.fixed;
  a.total += d.total;
  a.orders += d.orders;
  a.netRevenue += d.netRevenue;
  a.cm2 += d.cm2;
  a.purchases += d.purchases;
  a.purchaseValue += d.purchaseValue;
  a.metaOrders += d.channels.meta?.count ?? 0;
  a.googleOrders += d.channels.google?.count ?? 0;
  if (d.orders === 0) a.unallocated += d.total;
}

/** paise → ₹ + ratios */
function shape(a: Acc) {
  const adSpend = a.metaSpend + a.googleSpend;
  const cm3 = a.cm2 - a.total;
  return {
    metaSpend: rs(a.metaSpend),
    googleSpend: rs(a.googleSpend),
    adSpend: rs(adSpend),
    adGst: rs(a.adGst),
    commission: rs(a.commission),
    fixed: rs(a.fixed),
    team: rs(a.commission + a.fixed),
    total: rs(a.total),
    orders: a.orders,
    netRevenue: rs(a.netRevenue),
    cm2: rs(a.cm2),
    cm3: rs(cm3),
    marketingPerOrder: rs(div(a.total, a.orders)),
    adSpendPerOrder: rs(div(adSpend, a.orders)),
    /** MER = net revenue (ex-GST) ÷ ad spend */
    mer: r2(div(a.netRevenue, adSpend)),
    /** Platform-reported ROAS */
    platformRoas: r2(div(a.purchaseValue, adSpend)),
    /** POAS = contribution (CM2, marketing se pehle) ÷ ad spend */
    poas: r2(div(a.cm2, adSpend)),
    /** Break-even ROAS: isse kam ROAS = loss (revenue ÷ CM2) */
    breakEvenRoas: a.cm2 > 0 ? r2(a.netRevenue / a.cm2) : null,
    marketingPctOfRevenue: r2(div(a.total, a.netRevenue) * 100),
    purchases: a.purchases,
    purchaseValue: rs(a.purchaseValue),
    metaOrders: a.metaOrders,
    googleOrders: a.googleOrders,
    costPerMetaOrder: rs(div(a.metaSpend, a.metaOrders)),
    costPerGoogleOrder: rs(div(a.googleSpend, a.googleOrders)),
    unallocated: rs(a.unallocated),
  };
}

marketingReportRouter.get("/marketing", async (req, res) => {
  const { tid } = authOf(req);
  const q = marketingReportQuerySchema.parse(req.query);
  const daily = await computeDaily(tid, q.from, q.to);

  const totals = zero();
  const periods = new Map<string, Acc>();
  const memberAcc = new Map<string, { commission: number; fixed: number }>();
  const channelAcc = new Map<string, { count: number; revenue: number; cm2: number }>();

  for (const d of daily.values()) {
    add(totals, d);
    const k = periodKey(d.day, q.groupBy);
    const p = periods.get(k) ?? zero();
    add(p, d);
    periods.set(k, p);
    for (const m of d.members) {
      const x = memberAcc.get(m.memberId) ?? { commission: 0, fixed: 0 };
      x.commission += m.commission;
      x.fixed += m.fixed;
      memberAcc.set(m.memberId, x);
    }
    for (const [ch, b] of Object.entries(d.channels)) {
      const x = channelAcc.get(ch) ?? { count: 0, revenue: 0, cm2: 0 };
      x.count += b.count;
      x.revenue += b.revenue;
      x.cm2 += b.cm2;
      channelAcc.set(ch, x);
    }
  }

  const campaignMatch: Record<string, unknown> = { tenantId: new Types.ObjectId(tid), day: { $gte: q.from, $lte: q.to } };
  if (q.platform) campaignMatch.platform = q.platform;
  const [campaigns, members] = await Promise.all([
    AdSpend.aggregate<{ _id: { platform: string; campaignId: string }; name: string; accountId: string; spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number; days: number }>([
      { $match: campaignMatch },
      {
        $group: {
          _id: { platform: "$platform", campaignId: "$campaignId" },
          name: { $last: "$campaignName" },
          accountId: { $first: "$accountId" },
          spend: { $sum: "$spend" },
          impressions: { $sum: "$impressions" },
          clicks: { $sum: "$clicks" },
          purchases: { $sum: "$purchases" },
          purchaseValue: { $sum: "$purchaseValue" },
          days: { $sum: 1 },
        },
      },
      { $sort: { spend: -1 } },
      { $limit: 200 },
    ]),
    MarketingMember.find({ tenantId: tid }).lean(),
  ]);

  res.json({
    query: q,
    totals: shape(totals),
    periods: [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, a]) => ({ period, ...shape(a) })),
    campaigns: campaigns.map((c) => ({
      platform: c._id.platform,
      campaignId: c._id.campaignId,
      name: c.name ?? c._id.campaignId,
      accountId: c.accountId,
      spend: rs(c.spend),
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: r2(div(c.clicks, c.impressions) * 100),
      cpc: rs(div(c.spend, c.clicks)),
      purchases: c.purchases,
      purchaseValue: rs(c.purchaseValue),
      roas: r2(div(c.purchaseValue, c.spend)),
      costPerPurchase: rs(div(c.spend, c.purchases)),
    })),
    members: members.map((m) => {
      const x = memberAcc.get(String(m._id)) ?? { commission: 0, fixed: 0 };
      return {
        id: String(m._id),
        name: m.name,
        active: m.active,
        platforms: m.platforms,
        commissionType: m.commissionType,
        commissionValue: (m.commissionValue ?? 0) / 100,
        orderScope: m.orderScope,
        commission: rs(x.commission),
        fixed: rs(x.fixed),
        payout: rs(x.commission + x.fixed),
      };
    }),
    channels: [...channelAcc.entries()]
      .map(([channel, x]) => ({ channel, orders: x.count, netRevenue: rs(x.revenue), aov: rs(div(x.revenue, x.count)), cm2: rs(x.cm2) }))
      .sort((a, b) => b.orders - a.orders),
  });
});
