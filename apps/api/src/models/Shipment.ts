import { Schema, model, type InferSchemaType } from "mongoose";
import { DELIVERY_STATUSES, PAYMENT_MODES } from "@pnl/shared";

/** Saari amounts paise mein, GST ke bina (GST alag field mein — ITC) */
const chargesSchema = new Schema(
  {
    freight: { type: Number, default: 0 }, // forward freight
    cod: { type: Number, default: 0 }, // COD handling charge
    rto: { type: Number, default: 0 }, // RTO freight
    reverse: { type: Number, default: 0 }, // reverse pickup (customer return)
    weightDiscrepancy: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    /** ex-GST total = freight + cod + rto + reverse + weightDiscrepancy + other */
    total: { type: Number, default: 0 },
  },
  { _id: false },
);

const shipmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    /** courier integration (CSV import mein null ho sakta hai) */
    integrationId: { type: Schema.Types.ObjectId, ref: "Integration" },
    provider: { type: String, required: true }, // shiprocket | delhivery | csv
    /** provider ka unique id (Shiprocket shipment id / AWB) */
    externalId: { type: String, required: true },
    awb: { type: String, index: true },
    /** asli courier (Shiprocket ke andar Delhivery/Xpressbees/Bluedart...) */
    courierName: String,
    orderRef: String, // courier ke paas order number (channel_order_id)
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    orderName: String,
    orderDate: Date,
    paymentMode: { type: String, enum: PAYMENT_MODES },
    codAmount: Number,
    isReverse: { type: Boolean, default: false },

    status: { type: String, enum: DELIVERY_STATUSES, default: "booked" },
    statusRaw: String,
    shippedAt: Date,
    deliveredAt: Date,
    rtoInitiatedAt: Date,
    rtoDeliveredAt: Date,
    lastStatusAt: Date,

    weightGrams: Number, // applied / dead weight
    chargedWeightGrams: Number,
    zone: String,
    pickupPincode: String,
    pincode: String,
    city: String,
    state: String,

    charges: { type: chargesSchema, default: () => ({}) },
    chargesSource: { type: String, enum: ["api", "estimate", "invoice", "none"], default: "none" },
    /** Courier invoice CSV ke actual charges (reconciliation) */
    invoiceCharges: { type: chargesSchema },
    invoiceUploadedAt: Date,

    /** debugging ke liye trimmed raw payload */
    raw: { type: Schema.Types.Mixed, select: false },
  },
  { timestamps: true },
);

shipmentSchema.index({ tenantId: 1, provider: 1, externalId: 1 }, { unique: true });
shipmentSchema.index({ tenantId: 1, shippedAt: -1 });
shipmentSchema.index({ tenantId: 1, orderDate: -1 });
shipmentSchema.index({ tenantId: 1, orderId: 1 });
shipmentSchema.index({ tenantId: 1, awb: 1 });

export type ShipmentDoc = InferSchemaType<typeof shipmentSchema>;
export const Shipment = model("Shipment", shipmentSchema);

/** Report aur order ke liye effective charges: invoice ho to wahi (actual), warna API/estimate */
export function effectiveCharges(s: { charges?: ShipmentDoc["charges"] | null; invoiceCharges?: ShipmentDoc["charges"] | null }) {
  return s.invoiceCharges?.total != null && s.invoiceCharges.total > 0 ? s.invoiceCharges : s.charges;
}
