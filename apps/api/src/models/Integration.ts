import { Schema, model, type InferSchemaType } from "mongoose";

/**
 * Ek tenant ke multiple integrations ho sakte hain —
 * jaise 2 Shopify stores, Shiprocket + Delhivery dono, Razorpay + Cashfree.
 */
const integrationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    provider: { type: String, required: true },
    category: { type: String, enum: ["store", "ads", "shipping", "payment"], required: true },
    label: { type: String, trim: true },
    /** Non-secret fields plain */
    config: { type: Schema.Types.Mixed, default: {} },
    /** Secret fields: { key: encryptedString } */
    secrets: { type: Schema.Types.Mixed, default: {}, select: false },
    /** Webhook URL ke andar use hota hai, guessable nahi */
    webhookKey: { type: String, required: true, unique: true },
    /** Provider se mili info: shop name, scopes, timezone, webhooksRegisteredAt, sync cursors */
    meta: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "connected", "error", "disabled"], default: "pending" },
    lastError: String,
    lastSyncAt: Date,
  },
  { timestamps: true },
);

integrationSchema.index({ tenantId: 1, category: 1 });

export type IntegrationDoc = InferSchemaType<typeof integrationSchema>;
export const Integration = model("Integration", integrationSchema);
