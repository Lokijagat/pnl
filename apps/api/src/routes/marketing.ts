import { Router } from "express";
import { marketingMemberSchema, toPaise, type MarketingMemberInput } from "@pnl/shared";
import { MarketingMember } from "../models/MarketingMember";
import { authOf, requireAuth, requirePermission } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { queueAllocation } from "../jobs/handlers";

export const marketingRouter = Router();
marketingRouter.use(requireAuth);

/** UI rupees/percent bhejta hai; DB mein paise / basis-points (integer) */
function toDb(input: MarketingMemberInput) {
  return {
    ...input,
    email: input.email || undefined,
    phone: input.phone || undefined,
    commissionValue:
      input.commissionType === "per_order" ? toPaise(input.commissionValue) : Math.round(input.commissionValue * 100),
    monthlyFixed: toPaise(input.monthlyFixed),
    startDate: input.startDate ? new Date(input.startDate) : undefined,
  };
}

type Row = Record<string, unknown> & {
  _id: unknown;
  commissionType: string;
  commissionValue: number;
  monthlyFixed: number;
};

function fromDb(d: Row) {
  const { _id, __v: _v, tenantId: _t, ...rest } = d;
  return {
    ...rest,
    id: String(_id),
    commissionValue: d.commissionValue / 100, // paise→₹ ya bp→%
    monthlyFixed: d.monthlyFixed / 100,
  };
}

marketingRouter.get("/members", async (req, res) => {
  const { tid } = authOf(req);
  const rows = await MarketingMember.find({ tenantId: tid }).sort({ createdAt: 1 }).lean<Row[]>();
  res.json(rows.map(fromDb));
});

marketingRouter.post("/members", requirePermission("manageCosts"), async (req, res) => {
  const { tid } = authOf(req);
  const input = marketingMemberSchema.parse(req.body);
  const doc = await MarketingMember.create({ ...toDb(input), tenantId: tid });
  await queueAllocation(tid, 365);
  res.status(201).json(fromDb(doc.toObject() as unknown as Row));
});

marketingRouter.put("/members/:id", requirePermission("manageCosts"), async (req, res) => {
  const { tid } = authOf(req);
  const input = marketingMemberSchema.parse(req.body);
  const doc = await MarketingMember.findOneAndUpdate({ _id: req.params.id, tenantId: tid }, toDb(input), {
    new: true,
  }).lean<Row>();
  if (!doc) throw notFound();
  await queueAllocation(tid, 365);
  res.json(fromDb(doc));
});

marketingRouter.delete("/members/:id", requirePermission("manageCosts"), async (req, res) => {
  const { tid } = authOf(req);
  const r = await MarketingMember.deleteOne({ _id: req.params.id, tenantId: tid });
  if (!r.deletedCount) throw notFound();
  await queueAllocation(tid, 365);
  res.json({ ok: true });
});
