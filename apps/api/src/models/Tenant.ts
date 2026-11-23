import { Schema, model, type InferSchemaType } from "mongoose";

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    plan: { type: String, enum: ["trial", "basic", "pro"], default: "trial" },
    timezone: { type: String, default: "Asia/Kolkata" },
    currency: { type: String, default: "INR" },
    gstin: { type: String, trim: true },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    settings: {
      /** paise — box, tape, label, invoice per order */
      packingPerOrder: { type: Number, default: 0 },
      /** pehli sync mein kitne din purane orders */
      syncDays: { type: Number, default: 365 },
    },
  },
  { timestamps: true },
);

export type TenantDoc = InferSchemaType<typeof tenantSchema>;
export const Tenant = model("Tenant", tenantSchema);
