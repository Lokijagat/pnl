import { z } from "zod";

export const PAYMENT_MODES = ["prepaid", "cod", "partial_cod"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  prepaid: "Prepaid",
  cod: "COD",
  partial_cod: "Partial COD",
};

export const ORDER_STATUSES = ["open", "cancelled", "refunded", "partially_refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Variant cost update — rupees mein aata hai */
export const costUpdateSchema = z.object({
  cogs: z.coerce.number().min(0).max(10_000_000),
  packing: z.coerce.number().min(0).max(1_000_000).default(0),
  /** YYYY-MM-DD; is date (IST) se ye cost lagega */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date YYYY-MM-DD"),
});
export type CostUpdateInput = z.infer<typeof costUpdateSchema>;

export const costImportSchema = z.object({
  rows: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        cogs: z.coerce.number().min(0),
        packing: z.coerce.number().min(0).default(0),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .min(1)
    .max(5000),
});
export type CostImportInput = z.infer<typeof costImportSchema>;

export const tenantSettingsSchema = z.object({
  /** ₹ per order: box, tape, label, invoice, insert */
  packingPerOrder: z.coerce.number().min(0).max(100000),
  /** Pehli baar kitne din ke purane orders sync karne hain */
  syncDays: z.coerce.number().int().min(7).max(1095),
});
export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;

export const orderQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  storeId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type OrderQuery = z.infer<typeof orderQuerySchema>;

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
