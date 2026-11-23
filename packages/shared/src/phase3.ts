import { z } from "zod";
import { PAYMENT_MODES } from "./phase2";

/** Normalized shipment status (har courier ka status isme map hota hai) */
export const DELIVERY_STATUSES = [
  "booked", // AWB assigned / pickup pending
  "in_transit",
  "out_for_delivery",
  "ndr", // delivery attempt failed
  "delivered",
  "rto_initiated",
  "rto_in_transit",
  "rto_delivered",
  "lost",
  "cancelled",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  booked: "Booked",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  ndr: "NDR",
  delivered: "Delivered",
  rto_initiated: "RTO initiated",
  rto_in_transit: "RTO in transit",
  rto_delivered: "RTO delivered",
  lost: "Lost",
  cancelled: "Cancelled",
};

export const RTO_STATUSES: DeliveryStatus[] = ["rto_initiated", "rto_in_transit", "rto_delivered"];
export const isRtoStatus = (s?: string | null) => !!s && (RTO_STATUSES as string[]).includes(s);

/** Status groups for filters */
export const STATUS_GROUPS = {
  delivered: ["delivered"],
  rto: RTO_STATUSES,
  in_transit: ["booked", "in_transit", "out_for_delivery", "ndr"],
  cancelled: ["cancelled", "lost"],
} as const satisfies Record<string, readonly DeliveryStatus[]>;
export type StatusGroup = keyof typeof STATUS_GROUPS;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const deliveryReportQuerySchema = z.object({
  from: ymd,
  to: ymd,
  groupBy: z.enum(["day", "week", "month"]).default("week"),
  /** ship = shipment date, order = order date */
  dateBasis: z.enum(["ship", "order"]).default("ship"),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  statusGroup: z.enum(["delivered", "rto", "in_transit", "cancelled"]).optional(),
  courier: z.string().trim().max(100).optional(),
  integrationId: z.string().optional(),
  state: z.string().trim().max(100).optional(),
  zone: z.string().trim().max(20).optional(),
});
export type DeliveryReportQuery = z.infer<typeof deliveryReportQuerySchema>;

export const shipmentQuerySchema = deliveryReportQuerySchema
  .omit({ groupBy: true, from: true, to: true })
  .extend({
    from: ymd.optional(),
    to: ymd.optional(),
    q: z.string().trim().max(100).optional(),
    unmatched: z.enum(["1", "0"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });
export type ShipmentQuery = z.infer<typeof shipmentQuerySchema>;

const num = z.coerce.number().min(0).max(1_000_000).default(0);

/** Courier invoice / MIS CSV — kisi bhi courier ke liye. Amounts ₹ (GST ke bina). */
export const shipmentImportSchema = z.object({
  /** "invoice" = existing shipments ke actual charges (reconciliation); "shipments" = naye shipments bhi banao */
  mode: z.enum(["invoice", "shipments"]).default("shipments"),
  courierLabel: z.string().trim().max(80).default("CSV"),
  rows: z
    .array(
      z.object({
        awb: z.string().trim().min(1).max(60),
        order: z.string().trim().max(60).optional().default(""),
        courier: z.string().trim().max(80).optional().default(""),
        paymentMode: z.string().trim().max(20).optional().default(""),
        status: z.string().trim().max(40).optional().default(""),
        shippedDate: z.string().trim().max(30).optional().default(""),
        zone: z.string().trim().max(20).optional().default(""),
        weightKg: z.coerce.number().min(0).max(1000).default(0),
        pincode: z.string().trim().max(10).optional().default(""),
        freight: num,
        cod: num,
        rto: num,
        reverse: num,
        weightDiscrepancy: num,
        other: num,
        gst: num,
      }),
    )
    .min(1)
    .max(10000),
});
export type ShipmentImportInput = z.infer<typeof shipmentImportSchema>;
