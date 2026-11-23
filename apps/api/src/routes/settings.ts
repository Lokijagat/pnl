import { Router } from "express";
import { tenantSettingsSchema, toPaise } from "@pnl/shared";
import { Tenant } from "../models/Tenant";
import { authOf, requireAuth, requirePermission } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { enqueue } from "../jobs/queue";
import { JOB_TYPES } from "../jobs/handlers";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", async (req, res) => {
  const { tid } = authOf(req);
  const t = await Tenant.findById(tid, { settings: 1 }).lean();
  if (!t) throw notFound();
  res.json({ packingPerOrder: (t.settings?.packingPerOrder ?? 0) / 100, syncDays: t.settings?.syncDays ?? 365 });
});

settingsRouter.put("/", requirePermission("manageCosts"), async (req, res) => {
  const { tid } = authOf(req);
  const input = tenantSettingsSchema.parse(req.body);
  const before = await Tenant.findById(tid, { settings: 1 }).lean();
  const packing = toPaise(input.packingPerOrder);
  await Tenant.updateOne({ _id: tid }, { $set: { "settings.packingPerOrder": packing, "settings.syncDays": input.syncDays } });
  // per-order packing badla → saare orders recalc
  if ((before?.settings?.packingPerOrder ?? 0) !== packing) {
    await enqueue(tid, JOB_TYPES.ordersRecost, { payload: {}, dedupe: true });
  }
  res.json({ ok: true });
});
