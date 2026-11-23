/**
 * Meta Marketing API — Insights (campaign level, daily).
 * Token: Business Manager system user token (ads_read).
 */
import { moneyToPaise } from "@pnl/shared";
import { NonRetryableError } from "../../jobs/queue";
import type { LoadedIntegration } from "../../services/integrationCreds";
import { dayChunks, sleep, splitIds, type AdRow, type AdsAdapter } from "./common";

function base(integ: LoadedIntegration) {
  const root = process.env.NODE_ENV !== "production" && process.env.META_API_BASE_OVERRIDE ? process.env.META_API_BASE_OVERRIDE : "https://graph.facebook.com";
  return `${root}/${integ.config.apiVersion || "v23.0"}`;
}

const actId = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

interface MetaError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

async function getJson<T>(url: string, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  } catch (err) {
    if (attempt < 3) {
      await sleep(3000 * (attempt + 1));
      return getJson(url, attempt + 1);
    }
    throw new Error(`Meta se connect nahi ho paaya: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as T & MetaError;
  if (res.ok && !body.error) return body;

  const code = body.error?.code;
  const msg = body.error?.message ?? `HTTP ${res.status}`;
  // 190 = invalid/expired token, 200/10 = permission
  if (code === 190 || code === 200 || code === 10 || res.status === 401) {
    throw new NonRetryableError(`Meta token/permission error: ${msg}`);
  }
  if (code === 100) throw new NonRetryableError(`Meta request invalid (ad account ID check karo): ${msg}`);
  // 4/17/32/613/80004 = rate limit
  if ((code && [4, 17, 32, 613, 80000, 80004].includes(code)) || res.status >= 500) {
    if (attempt < 5) {
      await sleep(30_000 * (attempt + 1));
      return getJson(url, attempt + 1);
    }
  }
  throw new Error(`Meta API: ${msg}`);
}

const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"];

/* eslint-disable @typescript-eslint/no-explicit-any */
function pickAction(list: any[] | undefined): number {
  if (!Array.isArray(list)) return 0;
  for (const t of PURCHASE_TYPES) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export function mapMetaRow(accountId: string, r: any): AdRow {
  return {
    accountId,
    campaignId: String(r.campaign_id ?? "unknown"),
    campaignName: r.campaign_name,
    day: String(r.date_start),
    currency: r.account_currency,
    spend: moneyToPaise(String(r.spend ?? "0")),
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    purchases: Math.round(pickAction(r.actions)),
    purchaseValue: moneyToPaise(pickAction(r.action_values)),
  };
}

export const metaAdapter: AdsAdapter = {
  async test(integ) {
    const token = integ.secrets.accessToken;
    if (!token) throw new NonRetryableError("Meta access token missing");
    const ids = splitIds(integ.config.adAccountId);
    if (!ids.length) throw new NonRetryableError("Ad account ID missing");
    const accounts = [];
    for (const id of ids) {
      const r = await getJson<{ name?: string; currency?: string; account_status?: number; timezone_name?: string }>(
        `${base(integ)}/${actId(id)}?fields=name,currency,account_status,timezone_name&access_token=${encodeURIComponent(token)}`,
      );
      accounts.push({ id: actId(id), name: r.name, currency: r.currency, status: r.account_status, timezone: r.timezone_name });
    }
    return { info: { accounts } };
  },

  async sync(integ, since, until, onPage) {
    const token = integ.secrets.accessToken;
    if (!token) throw new NonRetryableError("Meta access token missing");
    let count = 0;
    for (const raw of splitIds(integ.config.adAccountId)) {
      const acc = actId(raw);
      // 30-din chunks: bada response / timeout se bachne ke liye
      for (const [a, b] of dayChunks(since, until, 30)) {
        const params = new URLSearchParams({
          level: "campaign",
          time_increment: "1",
          time_range: JSON.stringify({ since: a, until: b }),
          fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,account_currency,date_start",
          limit: "500",
          access_token: token,
        });
        let url: string | undefined = `${base(integ)}/${acc}/insights?${params}`;
        while (url) {
          const r: { data?: any[]; paging?: { next?: string } } = await getJson(url);
          const rows = (r.data ?? []).map((x) => mapMetaRow(acc, x));
          await onPage(rows);
          count += rows.length;
          url = r.paging?.next;
        }
      }
    }
    return count;
  },
};
