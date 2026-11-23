import { Schema, model, type InferSchemaType } from "mongoose";
import { COMMISSION_TYPES, ORDER_SCOPES } from "@pnl/shared";

/** Ads chalane wale marketing employees + unka commission rule */
const marketingMemberSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    platforms: [{ type: String, enum: ["meta", "google"] }],
    commissionType: { type: String, enum: COMMISSION_TYPES, required: true },
    /** per_order => paise; percent_* => basis points (2.5% = 250) */
    commissionValue: { type: Number, required: true, default: 0 },
    orderScope: { type: String, enum: ORDER_SCOPES, default: "all" },
    /** paise */
    monthlyFixed: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    startDate: Date,
  },
  { timestamps: true },
);

export type MarketingMemberDoc = InferSchemaType<typeof marketingMemberSchema>;
export const MarketingMember = model("MarketingMember", marketingMemberSchema);
