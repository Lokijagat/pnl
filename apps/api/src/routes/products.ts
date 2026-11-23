import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { costImportSchema, costUpdateSchema, toPaise } from "@pnl/shared";
import { CostHistory, Product, Variant } from "../models/Product";
import { authOf, requireAuth, requirePermission } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { istDate } from "../services/costing";
import { enqueue } from "../jobs/queue";
import { JOB_TYPES } from "../jobs/handlers";

export const productsRouter = Router();
productsRouter.use(requireAuth);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  missing: z.enum(["1", "0"]).optional(),
  storeId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const missingFilter = { currentCogs: null, shopifyUnitCost: null };

/** Variant ki "current" cost = aaj tak effective latest history */
async function refreshCurrentCost(variantId: Types.ObjectId | string) {
  const h = await CostHistory.findOne({ variantId, effectiveFrom: { $lte: new Date() } })
    .sort({ effectiveFrom: -1 })
    .lean();
  await Variant.updateOne(
    { _id: variantId },
    h ? { $set: { currentCogs: h.cogs, currentPacking: h.packing } } : { $unset: { currentCogs: 1, currentPacking: 1 } },
  );
}

productsRouter.get("/", async (req, res) => {
  const { tid } = authOf(req);
  const q = listQuery.parse(req.query);
  const filter: Record<string, unknown> = { tenantId: new Types.ObjectId(tid), deleted: { $ne: true } };
  if (q.storeId) filter.integrationId = new Types.ObjectId(q.storeId);
  if (q.q) {
    const re = new RegExp(escapeRe(q.q), "i");
    const pids = await Product.find({ tenantId: tid, title: re }, { _id: 1 }).lean();
    filter.$or = [{ sku: re }, { title: re }, { productId: { $in: pids.map((p) => p._id) } }];
  }
  if (q.missing === "1") Object.assign(filter, missingFilter);

  const [rows, total, missingCount] = await Promise.all([
    Variant.find(filter)
      .sort({ productId: 1, createdAt: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate<{ productId: { _id: Types.ObjectId; title: string; imageUrl?: string; status: string } }>("productId", "title imageUrl status")
      .lean(),
    Variant.countDocuments(filter),
    Variant.countDocuments({ tenantId: tid, deleted: { $ne: true }, ...missingFilter }),
  ]);

  res.json({
    total,
    missingCount,
    page: q.page,
    rows: rows.map((v) => ({
      id: String(v._id),
      productTitle: v.productId?.title ?? "",
      productStatus: v.productId?.status ?? "",
      imageUrl: v.productId?.imageUrl ?? null,
      title: v.title,
      sku: v.sku,
      price: v.price / 100,
      cogs: v.currentCogs != null ? v.currentCogs / 100 : null,
      packing: v.currentPacking != null ? v.currentPacking / 100 : null,
      shopifyUnitCost: v.shopifyUnitCost != null ? v.shopifyUnitCost / 100 : null,
    })),
  });
});

productsRouter.get("/variants/:id/costs", async (req, res) => {
  const { tid } = authOf(req);
  const rows = await CostHistory.find({ tenantId: tid, variantId: req.params.id }).sort({ effectiveFrom: -1 }).lean();
  res.json(
    rows.map((h) => ({ id: String(h._id), cogs: h.cogs / 100, packing: h.packing / 100, effectiveFrom: h.effectiveFrom, createdAt: h.createdAt })),
  );
});

productsRouter.post("/variants/:id/costs", requirePermission("manageCosts"), async (req, res) => {
  const { tid, sub } = authOf(req);
  const input = costUpdateSchema.parse(req.body);
  const variant = await Variant.findOne({ _id: req.params.id, tenantId: tid }, { _id: 1 }).lean();
  if (!variant) throw notFound("Variant nahi mila");
  const effectiveFrom = istDate(input.effectiveFrom);

  // Same date ki entry ho to replace
  await CostHistory.findOneAndUpdate(
    { tenantId: tid, variantId: variant._id, effectiveFrom },
    { cogs: toPaise(input.cogs), packing: toPaise(input.packing), createdBy: sub },
    { upsert: true },
  );
  await refreshCurrentCost(variant._id);
  const job = await enqueue(tid, JOB_TYPES.ordersRecost, { payload: { variantIds: [String(variant._id)], from: effectiveFrom.toISOString() } });
  res.status(201).json({ ok: true, recostJobId: String(job._id) });
});

productsRouter.delete("/costs/:historyId", requirePermission("manageCosts"), async (req, res) => {
  const { tid } = authOf(req);
  const h = await CostHistory.findOneAndDelete({ _id: req.params.historyId, tenantId: tid }).lean();
  if (!h) throw notFound();
  await refreshCurrentCost(h.variantId);
  await enqueue(tid, JOB_TYPES.ordersRecost, { payload: { variantIds: [String(h.variantId)] } });
  res.json({ ok: true });
});

/** CSV import: sku, cogs, packing, effectiveFrom. Ek SKU multiple variants par ho to sab par lagega. */
productsRouter.post("/costs/import", requirePermission("manageCosts"), async (req, res) => {
  const { tid, sub } = authOf(req);
  const { rows } = costImportSchema.parse(req.body);
  const skus = [...new Set(rows.map((r) => r.sku))];
  const variants = await Variant.find({ tenantId: tid, sku: { $in: skus }, deleted: { $ne: true } }, { sku: 1 }).lean();
  const bySku = new Map<string, Types.ObjectId[]>();
  for (const v of variants) bySku.set(v.sku, [...(bySku.get(v.sku) ?? []), v._id as Types.ObjectId]);

  const unmatched: string[] = [];
  const ops: Parameters<typeof CostHistory.bulkWrite>[0] = [];
  const touched = new Set<string>();
  let minDate: Date | null = null;
  for (const r of rows) {
    const ids = bySku.get(r.sku);
    if (!ids) {
      unmatched.push(r.sku);
      continue;
    }
    const effectiveFrom = istDate(r.effectiveFrom);
    if (!minDate || effectiveFrom < minDate) minDate = effectiveFrom;
    for (const variantId of ids) {
      touched.add(String(variantId));
      ops.push({
        updateOne: {
          filter: { tenantId: new Types.ObjectId(tid), variantId, effectiveFrom },
          update: { $set: { cogs: toPaise(r.cogs), packing: toPaise(r.packing), createdBy: new Types.ObjectId(sub) } },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await CostHistory.bulkWrite(ops);
  for (const id of touched) await refreshCurrentCost(id);
  if (touched.size) {
    await enqueue(tid, JOB_TYPES.ordersRecost, { payload: { variantIds: [...touched], from: minDate?.toISOString() } });
  }
  res.json({ updatedVariants: touched.size, rows: rows.length, unmatched: [...new Set(unmatched)] });
});
