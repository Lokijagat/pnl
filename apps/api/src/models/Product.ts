import { Schema, model, type InferSchemaType } from "mongoose";

const productSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    integrationId: { type: Schema.Types.ObjectId, ref: "Integration", required: true },
    shopifyId: { type: String, required: true }, // gid://shopify/Product/123
    title: { type: String, required: true },
    status: { type: String, default: "ACTIVE" }, // ACTIVE | DRAFT | ARCHIVED | DELETED
    vendor: String,
    productType: String,
    imageUrl: String,
  },
  { timestamps: true },
);
productSchema.index({ integrationId: 1, shopifyId: 1 }, { unique: true });

const variantSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    integrationId: { type: Schema.Types.ObjectId, ref: "Integration", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    shopifyId: { type: String, required: true }, // gid://shopify/ProductVariant/123
    sku: { type: String, default: "" },
    title: { type: String, default: "" },
    /** paise */
    price: { type: Number, default: 0 },
    /** paise — Shopify "Cost per item" (fallback COGS) */
    shopifyUnitCost: { type: Number },
    /** Latest cost (denormalized, list/filter fast karne ke liye) — paise */
    currentCogs: { type: Number },
    currentPacking: { type: Number },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
variantSchema.index({ integrationId: 1, shopifyId: 1 }, { unique: true });
variantSchema.index({ tenantId: 1, sku: 1 });

/** COGS + packing history. Order date par jo cost effective tha wahi lagta hai. */
const costHistorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    variantId: { type: Schema.Types.ObjectId, ref: "Variant", required: true },
    cogs: { type: Number, required: true }, // paise
    packing: { type: Number, default: 0 }, // paise
    effectiveFrom: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
costHistorySchema.index({ variantId: 1, effectiveFrom: -1 });
costHistorySchema.index({ tenantId: 1, variantId: 1 });

export type ProductDoc = InferSchemaType<typeof productSchema>;
export type VariantDoc = InferSchemaType<typeof variantSchema>;
export const Product = model("Product", productSchema);
export const Variant = model("Variant", variantSchema);
export const CostHistory = model("CostHistory", costHistorySchema);
