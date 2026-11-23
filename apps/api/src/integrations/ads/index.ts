import { Integration } from "../../models/Integration";
import { Tenant } from "../../models/Tenant";
import { NonRetryableError } from "../../jobs/queue";
import { loadIntegration, updateIntegrationMeta } from "../../services/integrationCreds";
import { upsertAdRows, type AdsAdapter } from "./common";
import { metaAdapter } from "./meta";
import { googleAdapter } from "./google";

export const ADS_ADAPTERS: Record<string, { adapter: AdsAdapter; platform: "meta" | "google" }> = {
  meta_ads: { adapter: metaAdapter, platform: "meta" },
  google_ads: { adapter: googleAdapter, platform: "google" },
};
export const hasAdsAdapter = (p: string) => p in ADS_ADAPTERS;

const ymdIST = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

export async function testAds(integrationId: string, tenantId: string) {
  const integ = await loadIntegration(integrationId, tenantId);
  const a = ADS_ADAPTERS[integ.provider];
  if (!a) return { ok: false, error: "Unsupported ads provider" };
  try {
    const r = await a.adapter.test(integ);
    await updateIntegrationMeta(integrationId, { ...(r.info ?? {}), testedAt: new Date() }, { status: "connected", lastError: null });
    return { ok: true, info: r.info };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await Integration.updateOne({ _id: integrationId }, { status: "error", lastError: msg });
    return { ok: false, error: msg };
  }
}

/**
 * Pehli baar: syncDays (max 365). Uske baad: last 7 din (platforms attribution/spend baad mein update karte hain).
 * Returns synced day range — marketing allocation isi range par chalta hai.
 */
export async function syncAds(integrationId: string, onProgress: (n: number, msg?: string) => Promise<void>, opts: { full?: boolean } = {}) {
  const integ = await loadIntegration(integrationId);
  const a = ADS_ADAPTERS[integ.provider];
  if (!a) throw new NonRetryableError(`No ads adapter for ${integ.provider}`);
  const tenant = await Tenant.findById(integ.tenantId, { settings: 1 }).lean();
  const first = !integ.meta.adsSyncedAt || opts.full;
  const days = first ? Math.min(tenant?.settings?.syncDays ?? 365, 365) : 7;
  const since = ymdIST(new Date(Date.now() - (days - 1) * 86_400_000));
  const until = ymdIST(new Date());

  let n = 0;
  await a.adapter.sync(integ, since, until, async (rows) => {
    await upsertAdRows(integ, a.platform, rows);
    n += rows.length;
    await onProgress(n, `Campaign-days: ${n}`);
  });
  await updateIntegrationMeta(integrationId, { adsSyncedAt: new Date() }, { lastSyncAt: new Date() });
  return { since, until, rows: n };
}
