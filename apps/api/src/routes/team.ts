import { Router } from "express";
import bcrypt from "bcryptjs";
import { inviteUserSchema } from "@pnl/shared";
import { User } from "../models/User";
import { authOf, requireAuth, requirePermission } from "../middleware/auth";
import { badRequest, conflict, notFound } from "../lib/errors";

export const teamRouter = Router();
teamRouter.use(requireAuth);

teamRouter.get("/", async (req, res) => {
  const { tid } = authOf(req);
  const users = await User.find({ tenantId: tid }).sort({ createdAt: 1 }).lean();
  res.json(
    users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, lastLoginAt: u.lastLoginAt })),
  );
});

/** Phase 1: owner seedha password set karke user banata hai. Baad mein email invite. */
teamRouter.post("/", requirePermission("manageTeam"), async (req, res) => {
  const { tid } = authOf(req);
  const input = inviteUserSchema.parse(req.body);
  if (await User.exists({ email: input.email })) throw conflict("Is email se user pehle se hai");
  const u = await User.create({
    tenantId: tid,
    name: input.name,
    email: input.email,
    role: input.role,
    passwordHash: await bcrypt.hash(input.password, 12),
  });
  res.status(201).json({ id: String(u._id), name: u.name, email: u.email, role: u.role });
});

teamRouter.delete("/:id", requirePermission("manageTeam"), async (req, res) => {
  const { tid, sub } = authOf(req);
  if (req.params.id === sub) throw badRequest("Khud ko remove nahi kar sakte");
  const r = await User.deleteOne({ _id: req.params.id, tenantId: tid, role: { $ne: "owner" } });
  if (!r.deletedCount) throw notFound();
  res.json({ ok: true });
});
