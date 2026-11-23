import { Router } from "express";
import { getProvider, integrationInputSchema, type ProviderDef } from "@pnl/shared";
import { Integration } from "../models/Integration";
import { authOf, requireAuth, requirePermission } from "../middleware/auth";
import { badRequest, notFound } from "../lib/errors";
import { decrypt, encrypt, mask, randomToken } from "../lib/crypto";
import { env } from "../config/env";
import { Job } from "../models/Job";
import { enqueue } from "../jobs/queue";
import { JOB_TYPES } from "../jobs/handlers";
import { registerWebhooks, testShopify } from "../integrations/shopify/sync";
import { hasCourierAdapter, testCourier } from "../integrations/courier";
import { hasAdsAdapter, testAds } from "../integrations/ads";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

type Doc = {
  _id: unknown;
  provider: string;
  category: string;
  label?: string | null;
  config?: Record<string, string>;
  secrets?: Record<string, string>;
  webhookKey: string;
  meta?: Record<string, unknown>;
  status: string;
  lastError?: string | null;
  lastSyncAt?: Date | null;
  createdAt?: Date;
};

const PUBLIC_META = ["shopName", "plan", "currency", "timezone", "scopes", "webhooksRegisteredAt", "webhookTopics", "ordersSyncedUntil", "productsSyncedAt", "shipmentsSyncedAt", "testedAt", "totalOrders", "pickupServiceable", "accounts", "adsSyncedAt"];
function pickMeta(meta: Record<string, unknown>) {
  return Object.fromEntries(PUBLIC_META.filter((k) => meta[k] !== undefined).map((k) => [k, meta[k]]));
}

/** Response mein secret kabhi plain nahi jaata */
function serialize(doc: Doc) {
  const def = getProvider(doc.provider);
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.secrets ?? {})) {
    try {
      masked[k] = mask(decrypt(v));
    } catch {
      masked[k] = "••••";
    }
  }
  return {
    id: String(doc._id),
    provider: doc.provider,
    providerName: def?.name ?? doc.provider,
    category: doc.category,
    label: doc.label ?? "",
    config: doc.config ?? {},
    maskedSecrets: masked,
    meta: pickMeta(doc.meta ?? {}),
    status: doc.status,
    lastError: doc.lastError ?? null,
    lastSyncAt: doc.lastSyncAt ?? null,
    createdAt: doc.createdAt,
    webhookUrl: def?.supportsWebhook
      ? doc.category === "shipping"
        ? `${env.PUBLIC_API_URL}/api/webhooks/courier/${doc.webhookKey}`
        : `${env.PUBLIC_API_URL}/api/webhooks/${doc.provider}/${doc.webhookKey}`
      : null,
  };
}

/**
 * Provider definition ke hisaab se credentials ko config (plain) aur secrets (encrypted) mein baanto.
 * Edit mode mein khaali secret = purana value rakho.
 */
function splitCredentials(
  def: ProviderDef,
  creds: Record<string, string>,
  existingSecrets: Record<string, string> = {},
) {
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = { ...existingSecrets };
  const missing: string[] = [];

  for (const f of def.fields) {
    const raw = (creds[f.key] ?? "").trim();
    const value = raw || (f.secret ? "" : (f.defaultValue ?? ""));

    if (f.type === "number" && value && Number.isNaN(Number(value))) {
      throw badRequest(`${f.label} number hona chahiye`);
    }
    if (f.type === "select" && value && f.options && !f.options.some((o) => o.value === value)) {
      throw badRequest(`${f.label} invalid hai`);
    }

    if (f.secret) {
      if (value) secrets[f.key] = encrypt(value);
      if (f.required && !secrets[f.key]) missing.push(f.label);
    } else {
      if (value) config[f.key] = value;
      if (f.required && !value) missing.push(f.label);
    }
  }
  if (missing.length) throw badRequest(`Required fields: ${missing.join(", ")}`);
  return { config, secrets };
}

integrationsRouter.get("/", async (req, res) => {
  const { tid } = authOf(req);
  const docs = await Integration.find({ tenantId: tid }).select("+secrets").sort({ createdAt: -1 }).lean<Doc[]>();
  res.json(docs.map(serialize));
});

integrationsRouter.post("/", requirePermission("manageIntegrations"), async (req, res) => {
  const { tid } = authOf(req);
  const input = integrationInputSchema.parse(req.body);
  const def = getProvider(input.provider);
  if (!def) throw badRequest("Unknown provider");

  const { config, secrets } = splitCredentials(def, input.credentials);
  const doc = await Integration.create({
    tenantId: tid,
    provider: def.id,
    category: def.category,
    label: input.label || def.name,
    config,
    secrets,
    webhookKey: randomToken(16),
    status: "pending", // Phase 2: "Test connection" ke baad connected
  });
  const saved = await Integration.findById(doc._id).select("+secrets").lean<Doc>();
  res.status(201).json(serialize(saved!));
});

integrationsRouter.put("/:id", requirePermission("manageIntegrations"), async (req, res) => {
  const { tid } = authOf(req);
  const doc = await Integration.findOne({ _id: req.params.id, tenantId: tid }).select("+secrets");
  if (!doc) throw notFound("Integration nahi mila");
  const def = getProvider(doc.provider);
  if (!def) throw badRequest("Unknown provider");

  const input = integrationInputSchema.parse({ ...req.body, provider: doc.provider });
  const { config, secrets } = splitCredentials(
    def,
    input.credentials,
    (doc.get("secrets") ?? {}) as Record<string, string>,
  );
  doc.set({ label: input.label || doc.label, config, secrets, status: "pending", lastError: undefined });
  doc.markModified("secrets");
  doc.markModified("config");
  await doc.save();
  res.json(serialize(doc.toObject() as unknown as Doc));
});

integrationsRouter.delete("/:id", requirePermission("manageIntegrations"), async (req, res) => {
  const { tid } = authOf(req);
  const r = await Integration.deleteOne({ _id: req.params.id, tenantId: tid });
  if (!r.deletedCount) throw notFound("Integration nahi mila");
  // Note: synced orders/products delete nahi hote (history safe). Phase 6: "purge data" option.
  res.json({ ok: true });
});

// ───────────── Actions ─────────────
async function ownIntegration(id: string, tid: string) {
  const doc = await Integration.findOne({ _id: id, tenantId: tid }, { provider: 1, status: 1 }).lean();
  if (!doc) throw notFound("Integration nahi mila");
  return doc;
}

integrationsRouter.post("/:id/test", requirePermission("manageIntegrations"), async (req, res) => {
  const { tid } = authOf(req);
  const doc = await ownIntegration(req.params.id as string, tid);
  if (doc.provider === "shopify") {
    res.json(await testShopify(String(doc._id), tid));
    return;
  }
  if (hasCourierAdapter(doc.provider)) {
    res.json(await testCourier(String(doc._id), tid));
    return;
  }
  if (hasAdsAdapter(doc.provider)) {
    res.json(await testAds(String(doc._id), tid));
    return;
  }
  throw badRequest("Is provider ka API test abhi available nahi");
});

integrationsRouter.post("/:id/sync", requirePermission("manageIntegrations"), async (req, res) => {
  const { tid } = authOf(req);
  const doc = await ownIntegration(req.params.id as string, tid);
  const isCourier = hasCourierAdapter(doc.provider);
  const isAds = hasAdsAdapter(doc.provider);
  if (doc.provider !== "shopify" && !isCourier && !isAds) throw badRequest("Is provider ka API sync abhi available nahi — CSV import use karo");
  if (doc.status !== "connected") throw badRequest("Pehle Test connection karo");
  const full = req.body?.full === true;
  const job = await enqueue(tid, isCourier ? JOB_TYPES.courierSync : isAds ? JOB_TYPES.adsSync : JOB_TYPES.shopifyFullSync, {
    integrationId: String(doc._id),
    payload: { full },
    dedupe: true,
  });
  res.status(202).json({ jobId: String(job._id) });
});

integrationsRouter.post("/:id/webhooks", requirePermission("manageIntegrations"), async (req, res) => {
  const { tid } = authOf(req);
  const doc = await ownIntegration(req.params.id as string, tid);
  if (doc.provider !== "shopify") throw badRequest("Is provider ke webhooks agle phase mein");
  res.json(await registerWebhooks(String(doc._id), tid));
});

integrationsRouter.get("/:id/jobs", async (req, res) => {
  const { tid } = authOf(req);
  const jobs = await Job.find({ tenantId: tid, integrationId: req.params.id }, { payload: 0 })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  res.json(
    jobs.map((j) => ({
      id: String(j._id),
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      progress: j.progress,
      error: j.error,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
    })),
  );
});
