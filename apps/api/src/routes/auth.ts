import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { loginSchema, signupSchema, type Role } from "@pnl/shared";
import { Tenant } from "../models/Tenant";
import { User } from "../models/User";
import { clearAuthCookies, setAuthCookies, signAccess, signRefresh, verifyRefresh } from "../lib/jwt";
import { conflict, unauthorized } from "../lib/errors";
import { authOf, requireAuth } from "../middleware/auth";
import { randomToken } from "../lib/crypto";

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "brand"
  );
}

type UserLike = { _id: unknown; tenantId: unknown; role: string; tokenVersion: number };

function issueTokens(res: Response, user: UserLike) {
  const access = signAccess({ sub: String(user._id), tid: String(user.tenantId), role: user.role as Role });
  const refresh = signRefresh({ sub: String(user._id), ver: user.tokenVersion });
  setAuthCookies(res, access, refresh);
}

async function profile(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw unauthorized();
  const tenant = await Tenant.findById(user.tenantId).lean();
  if (!tenant || tenant.status !== "active") throw unauthorized("Account inactive hai");
  return {
    user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
    tenant: { id: String(tenant._id), name: tenant.name, slug: tenant.slug, plan: tenant.plan },
  };
}

authRouter.post("/signup", authLimiter, async (req, res) => {
  const input = signupSchema.parse(req.body);
  if (await User.exists({ email: input.email })) throw conflict("Is email se account pehle se hai");

  let slug = slugify(input.brandName);
  if (await Tenant.exists({ slug })) slug = `${slug}-${randomToken(3)}`;

  const tenant = await Tenant.create({ name: input.brandName, slug });
  try {
    const user = await User.create({
      tenantId: tenant._id,
      name: input.name,
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, 12),
      role: "owner",
    });
    issueTokens(res, user);
    res.status(201).json(await profile(String(user._id)));
  } catch (err) {
    await Tenant.deleteOne({ _id: tenant._id }); // rollback
    throw err;
  }
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw unauthorized("Email ya password galat hai");
  }
  user.lastLoginAt = new Date();
  await user.save();
  issueTokens(res, user);
  res.json(await profile(String(user._id)));
});

authRouter.post("/refresh", async (req, res) => {
  const token = req.cookies?.refresh_token as string | undefined;
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = verifyRefresh(token);
  } catch {
    clearAuthCookies(res);
    throw unauthorized("Session expire ho gaya");
  }
  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.ver) {
    clearAuthCookies(res);
    throw unauthorized();
  }
  issueTokens(res, user);
  res.json(await profile(String(user._id)));
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.refresh_token as string | undefined;
  if (token) {
    try {
      const p = verifyRefresh(token);
      await User.updateOne({ _id: p.sub }, { $inc: { tokenVersion: 1 } });
    } catch {
      /* already invalid */
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json(await profile(authOf(req).sub));
});
