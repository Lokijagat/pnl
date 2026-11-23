/**
 * Google Ads API — GAQL searchStream (campaign × date).
 * Auth: OAuth refresh token → access token; developer-token header; MCC ho to login-customer-id.
 */
import { NonRetryableError } from "../../jobs/queue";
import type { LoadedIntegration } from "../../services/integrationCreds";
import { dayChunks, sleep, splitIds, type AdRow, type AdsAdapter } from "./common";

const dev = process.env.NODE_ENV !== "production";
const OAUTH_URL = dev && process.env.GOOGLE_OAUTH_URL_OVERRIDE ? process.env.GOOGLE_OAUTH_URL_OVERRIDE : "https://oauth2.googleapis.com/token";
const ADS_ROOT = dev && process.env.GOOGLE_ADS_API_BASE_OVERRIDE ? process.env.GOOGLE_ADS_API_BASE_OVERRIDE : "https://googleads.googleapis.com";

const cleanId = (v?: string) => (v ?? "").replace(/-/g, "").trim();
const tokens = new Map<string, { token: string; exp: number }>();

async function accessToken(integ: LoadedIntegration): Promise<string> {
  const c = tokens.get(integ.id);
  if (c && c.exp > Date.now()) return c.token;
  const { clientSecret, refreshToken } = integ.secrets;
  const clientId = integ.config.clientId;
  if (!clientId || !clientSecret || !refreshToken) throw new NonRetryableError("Google OAuth client ID / secret / refresh token missing");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new NonRetryableError(`Google OAuth fail: ${body.error_description ?? body.error ?? res.status} — client ID/secret/refresh token check karo`);
  }
  tokens.set(integ.id, { token: body.access_token, exp: Date.now() + ((body.expires_in ?? 3600) - 120) * 1000 });
  return body.access_token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function searchStream(integ: LoadedIntegration, customerId: string, query: string, attempt = 0): Promise<any[]> {
  const version = integ.config.apiVersion || "v22";
  const token = await accessToken(integ);
  const devToken = integ.secrets.developerToken;
  if (!devToken) throw new NonRetryableError("Google Ads developer token missing");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": devToken,
    "Content-Type": "application/json",
  };
  const login = cleanId(integ.config.loginCustomerId);
  if (login) headers["login-customer-id"] = login;

  const res = await fetch(`${ADS_ROOT}/${version}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 401 && attempt === 0) {
    tokens.delete(integ.id);
    return searchStream(integ, customerId, query, 1);
  }
  const body = (await res.json().catch(() => null)) as any;
  if (res.ok) return Array.isArray(body) ? body : [body];

  const err = Array.isArray(body) ? body[0]?.error : body?.error;
  const detail = err?.details?.[0]?.errors?.[0];
  const msg = detail?.message ?? err?.message ?? `HTTP ${res.status}`;
  const code = detail?.errorCode ? JSON.stringify(detail.errorCode) : "";
  if (res.status === 404) throw new NonRetryableError(`Google Ads API version "${version}" nahi mila — integration mein API version update karo`);
  if (res.status === 403 || res.status === 400) throw new NonRetryableError(`Google Ads: ${msg} ${code}`.trim());
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(15_000 * (attempt + 1));
    return searchStream(integ, customerId, query, attempt + 1);
  }
  throw new Error(`Google Ads: ${msg}`);
}

export function mapGoogleRow(customerId: string, r: any): AdRow {
  return {
    accountId: customerId,
    campaignId: String(r.campaign?.id ?? "unknown"),
    campaignName: r.campaign?.name,
    day: String(r.segments?.date),
    currency: r.customer?.currencyCode,
    // cost micros → paise (1 ₹ = 1,000,000 micros = 100 paise)
    spend: Math.round(Number(r.metrics?.costMicros ?? 0) / 10_000),
    impressions: Number(r.metrics?.impressions ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    purchases: Math.round(Number(r.metrics?.conversions ?? 0)),
    purchaseValue: Math.round(Number(r.metrics?.conversionsValue ?? 0) * 100),
  };
}

export const googleAdapter: AdsAdapter = {
  async test(integ) {
    const ids = splitIds(integ.config.customerId).map(cleanId);
    if (!ids.length) throw new NonRetryableError("Customer ID missing");
    const accounts = [];
    for (const id of ids) {
      const r = await searchStream(integ, id, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1");
      const c = r[0]?.results?.[0]?.customer ?? {};
      accounts.push({ id, name: c.descriptiveName, currency: c.currencyCode, timezone: c.timeZone });
    }
    return { info: { accounts } };
  },

  async sync(integ, since, until, onPage) {
    let count = 0;
    for (const id of splitIds(integ.config.customerId).map(cleanId)) {
      for (const [a, b] of dayChunks(since, until, 90)) {
        const q = `SELECT campaign.id, campaign.name, segments.date, customer.currency_code, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${a}' AND '${b}' AND metrics.cost_micros > 0`;
        const batches = await searchStream(integ, id, q);
        const rows = batches.flatMap((bt) => (bt.results ?? []).map((x: any) => mapGoogleRow(id, x)));
        await onPage(rows);
        count += rows.length;
      }
    }
    return count;
  },
};
