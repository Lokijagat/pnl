import { z } from "zod";
import { ROLES } from "./roles";

export const signupSchema = z.object({
  brandName: z.string().trim().min(2, "Brand name kam se kam 2 characters").max(80),
  name: z.string().trim().min(2, "Naam daalo").max(80),
  email: z.string().trim().toLowerCase().email("Sahi email daalo"),
  password: z.string().min(8, "Password kam se kam 8 characters").max(128),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Sahi email daalo"),
  password: z.string().min(1, "Password daalo"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const integrationInputSchema = z.object({
  provider: z.string().min(1),
  label: z.string().trim().max(80).optional(),
  /** field key -> value; secrets edit ke time khaali chhodo to purana value rahega */
  credentials: z.record(z.string(), z.string()),
});
export type IntegrationInput = z.infer<typeof integrationInputSchema>;

/** Marketing employee commission (1-10 log) */
export const COMMISSION_TYPES = [
  "per_order",          // har order par ₹X
  "percent_revenue",    // net revenue ka X%
  "percent_ad_spend",   // ad spend ka X%
  "percent_profit",     // contribution profit ka X%
  "none",               // sirf fixed salary
] as const;
export type CommissionType = (typeof COMMISSION_TYPES)[number];

export const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  per_order: "₹ per order",
  percent_revenue: "% of net revenue",
  percent_ad_spend: "% of ad spend",
  percent_profit: "% of contribution profit",
  none: "No commission (fixed only)",
};

export const ORDER_SCOPES = ["all", "meta", "google"] as const;
export type OrderScope = (typeof ORDER_SCOPES)[number];

export const marketingMemberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  platforms: z.array(z.enum(["meta", "google"])).min(1, "Kam se kam ek platform"),
  commissionType: z.enum(COMMISSION_TYPES),
  /** per_order => rupees, percent_* => percent */
  commissionValue: z.coerce.number().min(0).max(100000),
  /** Kaunse orders par commission: all orders / sirf Meta-attributed / sirf Google-attributed (UTM) */
  orderScope: z.enum(ORDER_SCOPES).default("all"),
  monthlyFixed: z.coerce.number().min(0).default(0),
  active: z.boolean().default(true),
  startDate: z.string().optional(),
});
export type MarketingMemberInput = z.infer<typeof marketingMemberSchema>;

export const inviteUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES).exclude(["owner"]),
  password: z.string().min(8),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
