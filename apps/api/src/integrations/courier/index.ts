import { Integration } from "../../models/Integration";
import { loadIntegration, updateIntegrationMeta } from "../../services/integrationCreds";
import { NonRetryableError } from "../../jobs/queue";
import { Tenant } from "../../models/Tenant";
import { upsertShipments } from "./common";
import { shiprocketAdapter } from "./shiprocket";
import { delhiveryAdapter } from "./delhivery";
import type { CourierAdapter } from "./types";

export const COURIER_ADAPTERS: Record<string, CourierAdapter> = {
  shiprocket: shiprocketAdapter,
  delhivery: delhiveryAdapter,
};

export const hasCourierAdapter = (provider: string) => provider in COURIER_ADAPTERS;

export async function testCourier(integrationId: string, tenantId: string) {
  const integ = await loadIntegration(integrationId, tenantId);
  const adapter = COURIER_ADAPTERS[integ.provider];
  if (!adapter) return { ok: false, error: "Is courier ka API abhi supported nahi — CSV import use karo" };
  try {
    const r = await adapter.test(integ);
    await updateIntegrationMeta(integrationId, { ...(r.info ?? {}), testedAt: new Date() }, { status: "connected", lastError: null });
    return { ok: true, info: r.info };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await Integration.updateOne({ _id: integrationId }, { status: "error", lastError: msg });
    return { ok: false, error: msg };
  }
}

/** Pehli baar: syncDays (max 180), uske baad last 45 din (status/charges update hote rehte hain) */
export async function syncCourier(integrationId: string, onProgress: (n: number, msg?: string) => Promise<void>, opts: { full?: boolean } = {}) {
  const integ = await loadIntegration(integrationId);
  const adapter = COURIER_ADAPTERS[integ.provider];
  if (!adapter) throw new NonRetryableError(`No adapter for ${integ.provider}`);
  const tenant = await Tenant.findById(integ.tenantId, { settings: 1 }).lean();
  const firstTime = !integ.meta.shipmentsSyncedAt || opts.full;
  const days = firstTime ? Math.min(tenant?.settings?.syncDays ?? 180, 180) : 45;
  const since = new Date(Date.now() - days * 86_400_000);

  let saved = 0;
  let matched = 0;
  const ctx = {
    tenantId: integ.tenantId,
    integrationId: integ.id,
    provider: integ.provider,
    includesGst: integ.config.chargesIncludeGst === "yes",
  };
  await adapter.sync(integ, since, async (list) => {
    const r = await upsertShipments(ctx, list);
    saved += r.upserted;
    matched += r.matched;
    await onProgress(saved, `Shipments: ${saved} · matched: ${matched}`);
  });
  await updateIntegrationMeta(integrationId, { shipmentsSyncedAt: new Date() }, { lastSyncAt: new Date() });
  return saved;
}
