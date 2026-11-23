import { Router } from "express";
import { Types } from "mongoose";
import { shipmentImportSchema, shipmentQuerySchema, toPaise } from "@pnl/shared";
import { Shipment } from "../models/Shipment";
import { authOf, requireAuth, requirePermission } from "../middleware/auth";
import { shipmentMatchStages } from "./reports";
import { finalizeCharges, matchShipments, parseIstDate, rollupOrders } from "../integrations/courier/common";
import { mapShiprocketStatus } from "../integrations/courier/shiprocket";

export const shipmentsRouter = Router();
shipmentsRouter.use(requireAuth);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rs = (p?: number | null) => (p ?? 0) / 100;

shipmentsRouter.get("/", async (req, res) => {
  const { tid } = authOf(req);
  const q = shipmentQuerySchema.parse(req.query);
  const stages = shipmentMatchStages(tid, q);
  const extra: Record<string, unknown> = {};
  if (q.unmatched === "1") extra.orderId = null;
  if (q.q) {
    const re = new RegExp(escapeRe(q.q), "i");
    extra.$or = [{ awb: re }, { orderName: re }, { orderRef: re }, { pincode: re }];
  }
  if (Object.keys(extra).length) stages.push({ $match: extra });

  const [r] = await Shipment.aggregate([
    ...stages,
    {
      $facet: {
        total: [{ $count: "n" }],
        rows: [
          { $sort: { d: -1 } },
          { $skip: (q.page - 1) * q.limit },
          { $limit: q.limit },
          { $project: { raw: 0 } },
        ],
      },
    },
  ]);

  res.json({
    total: r?.total?.[0]?.n ?? 0,
    page: q.page,
    rows: (r?.rows ?? []).map((s: Record<string, any>) => ({
      id: String(s._id),
      provider: s.provider,
      awb: s.awb,
      courierName: s.courierName,
      orderId: s.orderId ? String(s.orderId) : null,
      orderName: s.orderName ?? null,
      orderRef: s.orderRef ?? null,
      paymentMode: s.paymentMode ?? null,
      status: s.status,
      statusRaw: s.statusRaw,
      date: s.d,
      deliveredAt: s.deliveredAt,
      zone: s.zone,
      state: s.state,
      pincode: s.pincode,
      weightGrams: s.chargedWeightGrams ?? s.weightGrams ?? null,
      isReverse: !!s.isReverse,
      chargesSource: s.invoiceCharges?.total > 0 ? "invoice" : s.chargesSource,
      charges: {
        freight: rs(s.c?.freight),
        cod: rs(s.c?.cod),
        rto: rs(s.c?.rto),
        reverse: rs(s.c?.reverse),
        weightDiscrepancy: rs(s.c?.weightDiscrepancy),
        other: rs(s.c?.other),
        gst: rs(s.c?.gst),
        total: rs(s.c?.total),
      },
      /** API/estimate vs invoice ka farq (reconciliation) */
      invoiceDiff: s.invoiceCharges?.total > 0 && s.charges?.total > 0 ? rs(s.invoiceCharges.total - s.charges.total) : null,
    })),
  });
});

/**
 * Courier invoice / MIS CSV import (koi bhi courier).
 * - Existing AWB: actual (invoice) charges save → reconciliation, report actual use karta hai
 * - mode "shipments": naye AWB ke liye shipment bhi banao (jin couriers ka API nahi hai)
 */
shipmentsRouter.post("/import", requirePermission("manageCosts"), async (req, res) => {
  const { tid } = authOf(req);
  const input = shipmentImportSchema.parse(req.body);
  const tenantId = new Types.ObjectId(tid);
  const awbs = [...new Set(input.rows.map((r) => r.awb))];
  const existing = await Shipment.find({ tenantId, awb: { $in: awbs } }, { awb: 1, orderId: 1 }).lean();
  const byAwb = new Map(existing.map((s) => [s.awb!, s]));

  let updated = 0;
  let created = 0;
  const notFound: string[] = [];
  const ops: Parameters<typeof Shipment.bulkWrite>[0] = [];
  const now = new Date();

  for (const r of input.rows) {
    const charges = finalizeCharges(
      {
        freight: toPaise(r.freight),
        cod: toPaise(r.cod),
        rto: toPaise(r.rto),
        reverse: toPaise(r.reverse),
        weightDiscrepancy: toPaise(r.weightDiscrepancy),
        other: toPaise(r.other),
      },
      false,
      r.gst > 0 ? toPaise(r.gst) : undefined,
    );
    const ex = byAwb.get(r.awb);
    if (ex) {
      ops.push({ updateOne: { filter: { _id: ex._id }, update: { $set: { invoiceCharges: charges, invoiceUploadedAt: now } } } });
      updated++;
      continue;
    }
    if (input.mode === "invoice") {
      notFound.push(r.awb);
      continue;
    }
    const status = r.status ? mapShiprocketStatus(r.status) : "delivered";
    ops.push({
      updateOne: {
        filter: { tenantId, provider: "csv", externalId: r.awb },
        update: {
          $set: {
            awb: r.awb,
            courierName: r.courier || input.courierLabel,
            orderRef: r.order || undefined,
            paymentMode: r.paymentMode ? (/cod/i.test(r.paymentMode) ? "cod" : "prepaid") : undefined,
            status,
            statusRaw: r.status || undefined,
            shippedAt: parseIstDate(r.shippedDate),
            zone: r.zone ? r.zone.toUpperCase() : undefined,
            chargedWeightGrams: r.weightKg > 0 ? Math.round(r.weightKg * 1000) : undefined,
            pincode: r.pincode || undefined,
            charges,
            chargesSource: "invoice",
            invoiceCharges: charges,
            invoiceUploadedAt: now,
          },
        },
        upsert: true,
      },
    });
    created++;
  }
  if (ops.length) await Shipment.bulkWrite(ops);

  // match + order rollup
  const touched = await Shipment.find({ tenantId, awb: { $in: awbs } }, { _id: 1, orderId: 1 }).lean();
  const newly = await matchShipments(tid, touched.filter((t) => !t.orderId).map((t) => t._id as Types.ObjectId));
  const orderIds = [...new Set([...touched.map((t) => t.orderId).filter(Boolean).map(String), ...newly])];
  await rollupOrders(tid, orderIds);

  res.json({ rows: input.rows.length, updated, created, notFound: notFound.slice(0, 200), notFoundCount: notFound.length, ordersUpdated: orderIds.length });
});
