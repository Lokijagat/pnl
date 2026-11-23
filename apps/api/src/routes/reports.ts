import { Router } from "express";
import { Types, type PipelineStage } from "mongoose";
import { STATUS_GROUPS, deliveryReportQuerySchema, type DeliveryReportQuery } from "@pnl/shared";
import { Shipment } from "../models/Shipment";
import { authOf, requireAuth } from "../middleware/auth";
import { istDate, istEndOfDay } from "../services/costing";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const TZ = "Asia/Kolkata";

/** Shipment filters (report + list dono mein same) */
export function shipmentMatchStages(tenantId: string, q: Partial<DeliveryReportQuery>): PipelineStage[] {
  const match: Record<string, unknown> = { tenantId: new Types.ObjectId(tenantId) };
  if (q.paymentMode) match.paymentMode = q.paymentMode === "cod" ? { $in: ["cod", "partial_cod"] } : q.paymentMode;
  if (q.statusGroup) match.status = { $in: STATUS_GROUPS[q.statusGroup] };
  if (q.courier) match.courierName = q.courier;
  if (q.integrationId) match.integrationId = new Types.ObjectId(q.integrationId);
  if (q.state) match.state = q.state;
  if (q.zone) match.zone = q.zone;

  const stages: PipelineStage[] = [
    { $match: match },
    {
      $addFields: {
        d: q.dateBasis === "order" ? { $ifNull: ["$orderDate", "$shippedAt", "$createdAt"] } : { $ifNull: ["$shippedAt", "$orderDate", "$createdAt"] },
        // invoice (actual) charges ho to wahi, warna API/estimate
        c: { $cond: [{ $gt: [{ $ifNull: ["$invoiceCharges.total", 0] }, 0] }, "$invoiceCharges", "$charges"] },
        isCod: { $in: ["$paymentMode", ["cod", "partial_cod"]] },
        fwd: { $and: [{ $ne: ["$isReverse", true] }, { $ne: ["$status", "cancelled"] }] },
      },
    },
  ];
  if (q.from || q.to) {
    stages.push({
      $match: { d: { ...(q.from ? { $gte: istDate(q.from) } : {}), ...(q.to ? { $lte: istEndOfDay(q.to) } : {}) } },
    });
  }
  return stages;
}

const sumIf = (cond: unknown, val: unknown = 1) => ({ $sum: { $cond: [cond, val, 0] } });
const inArr = (arr: readonly string[]) => ({ $in: ["$status", arr] });

/** Sab breakdown mein same metrics */
const METRICS = {
  shipments: sumIf("$fwd"),
  prepaid: sumIf({ $and: ["$fwd", { $not: ["$isCod"] }] }),
  cod: sumIf({ $and: ["$fwd", "$isCod"] }),
  delivered: sumIf(inArr(STATUS_GROUPS.delivered)),
  rto: sumIf(inArr(STATUS_GROUPS.rto)),
  inTransit: sumIf(inArr(STATUS_GROUPS.in_transit)),
  cancelled: sumIf(inArr(STATUS_GROUPS.cancelled)),
  reverseCount: sumIf({ $eq: ["$isReverse", true] }),

  freight: { $sum: { $ifNull: ["$c.freight", 0] } },
  freightPrepaid: sumIf({ $not: ["$isCod"] }, { $ifNull: ["$c.freight", 0] }),
  freightCod: sumIf("$isCod", { $ifNull: ["$c.freight", 0] }),
  codCharges: { $sum: { $ifNull: ["$c.cod", 0] } },
  rtoCharges: { $sum: { $ifNull: ["$c.rto", 0] } },
  reverseCharges: { $sum: { $ifNull: ["$c.reverse", 0] } },
  weightDiscrepancy: { $sum: { $ifNull: ["$c.weightDiscrepancy", 0] } },
  other: { $sum: { $ifNull: ["$c.other", 0] } },
  gst: { $sum: { $ifNull: ["$c.gst", 0] } },
  total: { $sum: { $ifNull: ["$c.total", 0] } },
  prepaidCost: sumIf({ $not: ["$isCod"] }, { $ifNull: ["$c.total", 0] }),
  codCost: sumIf("$isCod", { $ifNull: ["$c.total", 0] }),
  noCharges: sumIf({ $and: ["$fwd", { $lte: [{ $ifNull: ["$c.total", 0] }, 0] }] }),
  estimated: sumIf({ $and: [{ $eq: ["$chargesSource", "estimate"] }, { $lte: [{ $ifNull: ["$invoiceCharges.total", 0] }, 0] }] }),
  invoiced: sumIf({ $gt: [{ $ifNull: ["$invoiceCharges.total", 0] }, 0] }),
};

type Raw = Record<keyof typeof METRICS, number> & { _id?: unknown };
const rs = (p: number) => Math.round(p) / 100;
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

/** paise → ₹ + per-order metrics */
function shape(r: Partial<Raw>) {
  const g = (k: keyof typeof METRICS) => r[k] ?? 0;
  const closed = g("delivered") + g("rto");
  return {
    shipments: g("shipments"),
    prepaid: g("prepaid"),
    cod: g("cod"),
    delivered: g("delivered"),
    rto: g("rto"),
    inTransit: g("inTransit"),
    cancelled: g("cancelled"),
    reverseCount: g("reverseCount"),
    rtoPct: closed > 0 ? (g("rto") / closed) * 100 : 0,
    freight: rs(g("freight")),
    freightPrepaid: rs(g("freightPrepaid")),
    freightCod: rs(g("freightCod")),
    codCharges: rs(g("codCharges")),
    rtoCharges: rs(g("rtoCharges")),
    reverseCharges: rs(g("reverseCharges")),
    weightDiscrepancy: rs(g("weightDiscrepancy")),
    other: rs(g("other")),
    gst: rs(g("gst")),
    total: rs(g("total")),
    prepaidCost: rs(g("prepaidCost")),
    codCost: rs(g("codCost")),
    perOrder: rs(div(g("total"), g("shipments"))),
    prepaidPerOrder: rs(div(g("prepaidCost"), g("prepaid"))),
    codPerOrder: rs(div(g("codCost"), g("cod"))),
    codChargePerCodOrder: rs(div(g("codCharges"), g("cod"))),
    rtoCostPerRto: rs(div(g("rtoCharges"), g("rto"))),
    noCharges: g("noCharges"),
    estimated: g("estimated"),
    invoiced: g("invoiced"),
  };
}

reportsRouter.get("/delivery", async (req, res) => {
  const { tid } = authOf(req);
  const q = deliveryReportQuerySchema.parse(req.query);
  const unit = q.groupBy;

  const [result] = await Shipment.aggregate([
    ...shipmentMatchStages(tid, q),
    {
      $facet: {
        totals: [{ $group: { _id: null, ...METRICS } }],
        periods: [
          {
            $group: {
              _id: { $dateTrunc: { date: "$d", unit, timezone: TZ, ...(unit === "week" ? { startOfWeek: "monday" } : {}) } },
              ...METRICS,
            },
          },
          { $sort: { _id: 1 } },
        ],
        byCourier: [{ $group: { _id: { $ifNull: ["$courierName", "Unknown"] }, ...METRICS } }, { $sort: { shipments: -1 } }],
        byState: [{ $group: { _id: { $ifNull: ["$state", "Unknown"] }, ...METRICS } }, { $sort: { shipments: -1 } }, { $limit: 40 }],
        byZone: [{ $group: { _id: { $ifNull: ["$zone", "—"] }, ...METRICS } }, { $sort: { _id: 1 } }],
        rtoPincodes: [
          { $match: { fwd: true, pincode: { $ne: null } } },
          {
            $group: {
              _id: "$pincode",
              state: { $first: "$state" },
              city: { $first: "$city" },
              shipments: { $sum: 1 },
              rto: sumIf(inArr(STATUS_GROUPS.rto)),
              delivered: sumIf(inArr(STATUS_GROUPS.delivered)),
              rtoCharges: { $sum: { $ifNull: ["$c.rto", 0] } },
            },
          },
          { $match: { rto: { $gte: 2 } } },
          { $addFields: { rtoPct: { $multiply: [{ $divide: ["$rto", { $max: [{ $add: ["$rto", "$delivered"] }, 1] }] }, 100] } } },
          { $sort: { rto: -1, rtoPct: -1 } },
          { $limit: 25 },
        ],
      },
    },
  ]);

  const [couriers, states, zones, unmatched] = await Promise.all([
    Shipment.distinct("courierName", { tenantId: tid }),
    Shipment.distinct("state", { tenantId: tid }),
    Shipment.distinct("zone", { tenantId: tid }),
    Shipment.countDocuments({ tenantId: tid, orderId: null }),
  ]);

  const fmtPeriod = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  res.json({
    query: q,
    totals: shape(result?.totals?.[0] ?? {}),
    periods: (result?.periods ?? []).map((p: Raw) => ({ period: fmtPeriod(p._id as Date), ...shape(p) })),
    byCourier: (result?.byCourier ?? []).map((p: Raw) => ({ key: p._id, ...shape(p) })),
    byState: (result?.byState ?? []).map((p: Raw) => ({ key: p._id, ...shape(p) })),
    byZone: (result?.byZone ?? []).map((p: Raw) => ({ key: p._id, ...shape(p) })),
    rtoPincodes: (result?.rtoPincodes ?? []).map((p: { _id: string; state?: string; city?: string; shipments: number; rto: number; delivered: number; rtoPct: number; rtoCharges: number }) => ({
      pincode: p._id,
      state: p.state,
      city: p.city,
      shipments: p.shipments,
      rto: p.rto,
      delivered: p.delivered,
      rtoPct: p.rtoPct,
      rtoCharges: rs(p.rtoCharges),
    })),
    options: {
      couriers: couriers.filter(Boolean).sort(),
      states: states.filter(Boolean).sort(),
      zones: zones.filter(Boolean).sort(),
    },
    unmatchedShipments: unmatched,
  });
});
