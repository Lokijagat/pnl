import { Types } from "mongoose";
import { AdSpend } from "../../models/AdSpend";
import type { LoadedIntegration } from "../../services/integrationCreds";
import { istDate } from "../../services/costing";

/** Adapter output (amounts paise) */
export interface AdRow {
  accountId: string;
  campaignId: string;
  campaignName?: string;
  day: string; // YYYY-MM-DD
  currency?: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
}

export interface AdsAdapter {
  test(integ: LoadedIntegration): Promise<{ info?: Record<string, unknown> }>;
  /** [since, until] (YYYY-MM-DD) ke daily campaign rows; onPage par save */
  sync(integ: LoadedIntegration, since: string, until: string, onPage: (rows: AdRow[]) => Promise<void>): Promise<number>;
}

export const AD_GST_RATE = 0.18;

export async function upsertAdRows(integ: LoadedIntegration, platform: "meta" | "google", rows: AdRow[]) {
  if (!rows.length) return;
  const tenantId = new Types.ObjectId(integ.tenantId);
  const integrationId = new Types.ObjectId(integ.id);
  const gstOn = integ.config.gstOnSpend !== "no";
  await AdSpend.bulkWrite(
    rows.map((r) => ({
      updateOne: {
        filter: { integrationId, accountId: r.accountId, campaignId: r.campaignId, day: r.day },
        update: {
          $set: {
            tenantId,
            platform,
            campaignName: r.campaignName,
            date: istDate(r.day),
            currency: r.currency ?? "INR",
            spend: r.spend,
            gst: gstOn ? Math.round(r.spend * AD_GST_RATE) : 0,
            impressions: r.impressions,
            clicks: r.clicks,
            purchases: r.purchases,
            purchaseValue: r.purchaseValue,
          },
        },
        upsert: true,
      },
    })) as never,
  );
}

/** "a, b ,c" → ["a","b","c"] */
export const splitIds = (v?: string) =>
  (v ?? "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** [from,to] ko N-din ke chunks mein todo */
export function dayChunks(from: string, to: string, size: number): [string, string][] {
  const out: [string, string][] = [];
  let cur = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cur <= end) {
    const chunkEnd = new Date(Math.min(+cur + (size - 1) * 86_400_000, +end));
    out.push([cur.toISOString().slice(0, 10), chunkEnd.toISOString().slice(0, 10)]);
    cur = new Date(+chunkEnd + 86_400_000);
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
