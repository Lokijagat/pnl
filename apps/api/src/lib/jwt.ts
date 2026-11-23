import jwt from "jsonwebtoken";
import type { Response } from "express";
import type { Role } from "@pnl/shared";
import { env, isProd } from "../config/env";

export interface AccessPayload {
  sub: string; // userId
  tid: string; // tenantId
  role: Role;
}
export interface RefreshPayload {
  sub: string;
  ver: number; // tokenVersion — logout/password change par badhta hai
}

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;

export const signAccess = (p: AccessPayload) => jwt.sign(p, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL_SEC });
export const signRefresh = (p: RefreshPayload) => jwt.sign(p, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL_SEC });
export const verifyAccess = (t: string) => jwt.verify(t, env.JWT_ACCESS_SECRET) as AccessPayload;
export const verifyRefresh = (t: string) => jwt.verify(t, env.JWT_REFRESH_SECRET) as RefreshPayload;

const base = { httpOnly: true, secure: isProd, sameSite: isProd ? ("none" as const) : ("lax" as const) };

export function setAuthCookies(res: Response, access: string, refresh: string) {
  res.cookie("access_token", access, { ...base, maxAge: ACCESS_TTL_SEC * 1000 });
  res.cookie("refresh_token", refresh, { ...base, maxAge: REFRESH_TTL_SEC * 1000, path: "/api/auth" });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie("access_token", base);
  res.clearCookie("refresh_token", { ...base, path: "/api/auth" });
}
