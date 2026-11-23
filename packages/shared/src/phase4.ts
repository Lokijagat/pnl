import { z } from "zod";

export const AD_PLATFORMS = ["meta", "google"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];
export const AD_PLATFORM_LABELS: Record<AdPlatform, string> = { meta: "Meta", google: "Google" };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const marketingReportQuerySchema = z.object({
  from: ymd,
  to: ymd,
  groupBy: z.enum(["day", "week", "month"]).default("week"),
  platform: z.enum(AD_PLATFORMS).optional(),
});
export type MarketingReportQuery = z.infer<typeof marketingReportQuerySchema>;
