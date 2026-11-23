import { Router } from "express";
import { Types } from "mongoose";
import { orderQuerySchema } from "@pnl/shared";
import { Order } from "../models/Order";
import { Shipment, effectiveCharges } from "../models/Shipment";
import { authOf, requireAuth } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { istDate, istEndOfDay } from "../services/costing";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const r = (paise: number | null | undefined) => (paise ?? 0) / 100;

ordersRouter.get("/", async (req, res) => {
  const { tid } = authOf(req);
  const q = orderQuerySchema.parse(req.query);

  const filter: Record<string, unknown> = { tenantId: new Types.ObjectId(tid) };
  if (q.from || q.to) {
    filter.processedAt = {
      ...(q.from ? { $gte: istDate(q.from) } : {}),
      ...(q.to ? { $lte: istEndOfDay(q.to) } : {}),
    };
  }
  if (q.paymentMode) filter.paymentMode = q.paymentMode;
  if (q.status) filter.status = q.status;
  if (q.storeId) filter.integrationId = new Types.ObjectId(q.storeId);
  if (q.q) {
    const re = new RegExp(escapeRe(q.q), "i");
    filter.$or = [{ name: re }, { "lineItems.sku": re }, { "shipping.pincode": re }];
  }

  const [rows, summaryArr] = await Promise.all([
    Order.find(filter, {
      name: 1, processedAt: 1, status: 1, paymentMode: 1, financialStatus: 1, fulfillmentStatus: 1,
      totalPrice: 1, tax: 1, refunded: 1, netRevenue: 1, cogs: 1, packing: 1, grossProfit: 1, costMissing: 1, shippingCost: 1, cm2: 1, marketingCost: 1, cm3: 1, deliveryStatus: 1, courier: 1, isRto: 1,
      "shipping.state": 1, "shipping.pincode": 1, "utm.channel": 1, lineItems: { $slice: 3 },
    })
      .sort({ processedAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Order.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          cod: { $sum: { $cond: [{ $eq: ["$paymentMode", "cod"] }, 1, 0] } },
          prepaid: { $sum: { $cond: [{ $eq: ["$paymentMode", "prepaid"] }, 1, 0] } },
          partialCod: { $sum: { $cond: [{ $eq: ["$paymentMode", "partial_cod"] }, 1, 0] } },
          totalPrice: { $sum: "$totalPrice" },
          tax: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, "$tax"] } },
          refunded: { $sum: "$refunded" },
          netRevenue: { $sum: "$netRevenue" },
          cogs: { $sum: "$cogs" },
          packing: { $sum: "$packing" },
          grossProfit: { $sum: "$grossProfit" },
          shippingCost: { $sum: "$shippingCost" },
          cm2: { $sum: "$cm2" },
          marketingCost: { $sum: "$marketingCost" },
          cm3: { $sum: "$cm3" },
          rto: { $sum: { $cond: ["$isRto", 1, 0] } },
          shipped: { $sum: { $cond: [{ $gt: ["$shipmentCount", 0] }, 1, 0] } },
          costMissing: { $sum: { $cond: ["$costMissing", 1, 0] } },
        },
      },
    ]),
  ]);

  const s = summaryArr[0] ?? {};
  const active = (s.orders ?? 0) - (s.cancelled ?? 0);
  res.json({
    total: s.orders ?? 0,
    page: q.page,
    summary: {
      orders: s.orders ?? 0,
      activeOrders: active,
      cancelled: s.cancelled ?? 0,
      cod: s.cod ?? 0,
      prepaid: s.prepaid ?? 0,
      partialCod: s.partialCod ?? 0,
      grossSales: r(s.totalPrice),
      tax: r(s.tax),
      refunded: r(s.refunded),
      netRevenue: r(s.netRevenue),
      cogs: r(s.cogs),
      packing: r(s.packing),
      grossProfit: r(s.grossProfit),
      shippingCost: r(s.shippingCost),
      cm2: r(s.cm2),
      marketingCost: r(s.marketingCost),
      cm3: r(s.cm3),
      rto: s.rto ?? 0,
      shipped: s.shipped ?? 0,
      aov: active > 0 ? r(s.netRevenue) / active : 0,
      costMissing: s.costMissing ?? 0,
    },
    rows: rows.map((o) => ({
      id: String(o._id),
      name: o.name,
      processedAt: o.processedAt,
      status: o.status,
      paymentMode: o.paymentMode,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      totalPrice: r(o.totalPrice),
      tax: r(o.tax),
      refunded: r(o.refunded),
      netRevenue: r(o.netRevenue),
      cogs: r(o.cogs),
      packing: r(o.packing),
      grossProfit: r(o.grossProfit),
      shippingCost: r(o.shippingCost),
      cm2: r(o.cm2),
      marketingCost: r(o.marketingCost),
      cm3: r(o.cm3),
      deliveryStatus: o.deliveryStatus ?? null,
      courier: o.courier ?? null,
      isRto: !!o.isRto,
      costMissing: o.costMissing,
      state: o.shipping?.state,
      pincode: o.shipping?.pincode,
      channel: o.utm?.channel,
      items: (o.lineItems ?? []).map((l) => `${l.quantity}× ${l.title}`).join(", "),
    })),
  });
});

ordersRouter.get("/:id", async (req, res) => {
  const { tid } = authOf(req);
  const o = await Order.findOne({ _id: req.params.id, tenantId: tid }).lean();
  if (!o) throw notFound("Order nahi mila");
  const shipments = await Shipment.find({ tenantId: tid, orderId: o._id }).lean();
  res.json({
    shipments: shipments.map((sh) => {
      const c = effectiveCharges(sh);
      return {
        id: String(sh._id), awb: sh.awb, courierName: sh.courierName, provider: sh.provider, status: sh.status, statusRaw: sh.statusRaw,
        isReverse: sh.isReverse, zone: sh.zone, chargesSource: sh.invoiceCharges?.total ? "invoice" : sh.chargesSource,
        charges: { freight: r(c?.freight), cod: r(c?.cod), rto: r(c?.rto), reverse: r(c?.reverse), weightDiscrepancy: r(c?.weightDiscrepancy), other: r(c?.other), gst: r(c?.gst), total: r(c?.total) },
      };
    }),
    ...o,
    id: String(o._id),
    _id: undefined,
    tenantId: undefined,
    // UI ke liye rupees
    money: {
      grossSales: r(o.grossSales), discounts: r(o.discounts), shippingCharged: r(o.shippingCharged), tax: r(o.tax),
      totalPrice: r(o.totalPrice), refunded: r(o.refunded), netRevenue: r(o.netRevenue), cogs: r(o.cogs),
      packing: r(o.packing), grossProfit: r(o.grossProfit), shippingCost: r(o.shippingCost), shippingGst: r(o.shippingGst), cm2: r(o.cm2), marketingCost: r(o.marketingCost), cm3: r(o.cm3),
    },
    lineItems: o.lineItems.map((l) => ({
      ...l,
      unitPrice: r(l.unitPrice), discount: r(l.discount), tax: r(l.tax), cogsUnit: r(l.cogsUnit), packingUnit: r(l.packingUnit),
    })),
  });
});
