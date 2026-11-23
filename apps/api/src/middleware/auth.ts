import type { Request, RequestHandler } from "express";
import { can, type Permission } from "@pnl/shared";
import { verifyAccess, type AccessPayload } from "../lib/jwt";
import { forbidden, unauthorized } from "../lib/errors";

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.access_token as string | undefined;
  if (!token) throw unauthorized();
  try {
    req.auth = verifyAccess(token);
  } catch {
    throw unauthorized("Session expire ho gaya");
  }
  next();
};

export const requirePermission =
  (perm: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth || !can(req.auth.role, perm)) throw forbidden();
    next();
  };

/** requireAuth ke baad use karo — tenant isolation ka single source */
export function authOf(req: Request): AccessPayload {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
