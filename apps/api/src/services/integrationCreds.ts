import { Integration } from "../models/Integration";
import { decrypt } from "../lib/crypto";
import { notFound } from "../lib/errors";

export interface LoadedIntegration {
  id: string;
  tenantId: string;
  provider: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
  meta: Record<string, unknown>;
}

/** Integration + decrypted secrets. Sirf server-side use karo — kabhi response mein mat bhejo. */
export async function loadIntegration(integrationId: string, tenantId?: string): Promise<LoadedIntegration> {
  const filter: Record<string, unknown> = { _id: integrationId };
  if (tenantId) filter.tenantId = tenantId;
  const doc = await Integration.findOne(filter).select("+secrets").lean<{
    _id: unknown;
    tenantId: unknown;
    provider: string;
    config?: Record<string, string>;
    secrets?: Record<string, string>;
    meta?: Record<string, unknown>;
  }>();
  if (!doc) throw notFound("Integration nahi mila");
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.secrets ?? {})) secrets[k] = decrypt(v);
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    provider: doc.provider,
    config: doc.config ?? {},
    secrets,
    meta: doc.meta ?? {},
  };
}

/** meta mein kuch keys merge karo (dot-path $set) */
export async function updateIntegrationMeta(integrationId: string, patch: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const set: Record<string, unknown> = { ...extra };
  for (const [k, v] of Object.entries(patch)) set[`meta.${k}`] = v;
  await Integration.updateOne({ _id: integrationId }, { $set: set });
}
