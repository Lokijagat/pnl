import { Schema, model, type InferSchemaType } from "mongoose";
import { AD_PLATFORMS } from "@pnl/shared";

/** Campaign × din ka ad spend (paise, ex-GST) */
const adSpendSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    integrationId: { type: Schema.Types.ObjectId, ref: "Integration", required: true },
    platform: { type: String, enum: AD_PLATFORMS, required: true },
    accountId: { type: String, required: true },
    campaignId: { type: String, required: true },
    campaignName: String,
    /** "2026-11-21" (account timezone ka din) */
    day: { type: String, required: true },
    /** din ka 00:00 IST — range queries ke liye */
    date: { type: Date, required: true },
    currency: { type: String, default: "INR" },
    spend: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    /** platform-reported conversions */
    purchases: { type: Number, default: 0 },
    purchaseValue: { type: Number, default: 0 },
  },
  { timestamps: true },
);

adSpendSchema.index({ integrationId: 1, accountId: 1, campaignId: 1, day: 1 }, { unique: true });
adSpendSchema.index({ tenantId: 1, date: 1, platform: 1 });

export type AdSpendDoc = InferSchemaType<typeof adSpendSchema>;
export const AdSpend = model("AdSpend", adSpendSchema);
