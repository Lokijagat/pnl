import { Schema, model, type InferSchemaType } from "mongoose";
import { ORDER_STATUSES, PAYMENT_MODES } from "@pnl/shared";

/** Saari amounts paise mein */
const lineItemSchema = new Schema(
  {
    shopifyId: String,
    variantShopifyId: String,
    variantId: { type: Schema.Types.ObjectId, ref: "Variant" },
    sku: String,
    title: String,
    quantity: Number,
    /** refund ke baad bachi quantity */
    currentQuantity: Number,
    unitPrice: Number,
    discount: Number,
    tax: Number,
    taxRateBp: Number, // 18% = 1800
    /** cost snapshot per unit */
    cogsUnit: { type: Number, default: 0 },
    packingUnit: { type: Number, default: 0 },
    costMissing: { type: Boolean, default: false },
  },
  { _id: false },
);

const refundSchema = new Schema(
  {
    shopifyId: String,
    createdAt: Date,
    amount: Number,
    lines: [{ _id: false, lineItemShopifyId: String, quantity: Number, subtotal: Number }],
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    integrationId: { type: Schema.Types.ObjectId, ref: "Integration", required: true },
    shopifyId: { type: String, required: true },
    name: { type: String, required: true }, // #1001
    processedAt: { type: Date, required: true },
    shopifyUpdatedAt: Date,
    cancelledAt: Date,
    cancelReason: String,
    financialStatus: String,
    fulfillmentStatus: String,
    status: { type: String, enum: ORDER_STATUSES, default: "open" },
    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },
    gateways: [String],
    sourceName: String,
    tags: [String],
    currency: { type: String, default: "INR" },
    taxesIncluded: Boolean,

    // money (paise)
    grossSales: { type: Number, default: 0 }, // Σ unitPrice × qty
    discounts: { type: Number, default: 0 },
    shippingCharged: { type: Number, default: 0 }, // customer se liya shipping
    tax: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    /** GST ke bina, refund ke baad */
    netRevenue: { type: Number, default: 0 },

    // cost snapshot (paise)
    cogs: { type: Number, default: 0 },
    packing: { type: Number, default: 0 },
    costMissing: { type: Boolean, default: false },
    /** CM1 = netRevenue − cogs − packing (Phase 3+ mein shipping, fees, marketing bhi) */
    grossProfit: { type: Number, default: 0 },

    lineItems: [lineItemSchema],
    refunds: [refundSchema],
    /** Shopify fulfillments ka tracking (AWB matching ke liye) */
    fulfillments: [{ _id: false, company: String, number: String, createdAt: Date, status: String }],

    // ── Shipping (Phase 3) — paise, ex-GST ──
    shippingCost: { type: Number, default: 0 },
    shippingGst: { type: Number, default: 0 },
    shipmentCount: { type: Number, default: 0 },
    courier: String,
    awb: String,
    deliveryStatus: String,
    isRto: { type: Boolean, default: false },
    /** CM2 = CM1 − shipping (Phase 5 mein gateway fee bhi) */
    cm2: { type: Number, default: 0 },

    // ── Marketing (Phase 4) — us din ka (ads + commission + salary) ÷ us din ke orders ──
    marketingCost: { type: Number, default: 0 },
    /** CM3 = CM2 − marketing */
    cm3: { type: Number, default: 0 },

    shipping: { city: String, state: String, stateCode: String, pincode: String, country: String },
    customer: { shopifyId: String, ordersCount: Number, isRepeat: Boolean },
    utm: { source: String, medium: String, campaign: String, channel: String },
  },
  { timestamps: true },
);

orderSchema.index({ integrationId: 1, shopifyId: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, processedAt: -1 });
orderSchema.index({ tenantId: 1, paymentMode: 1, processedAt: -1 });
orderSchema.index({ tenantId: 1, name: 1 });
orderSchema.index({ tenantId: 1, "lineItems.variantId": 1, processedAt: 1 });
orderSchema.index({ tenantId: 1, "fulfillments.number": 1 });

export type OrderDoc = InferSchemaType<typeof orderSchema>;
export const Order = model("Order", orderSchema);
