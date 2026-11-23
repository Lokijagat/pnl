/**
 * Paisa hamesha PAISE (integer) mein store karo. ₹199.50 => 19950
 * Float se rounding bugs aate hain.
 */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => paise / 100;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
export const formatINR = (paise: number): string => inr.format(paise / 100);

/** GST-inclusive price se GST alag karo: 118 @18% => { base: 100, gst: 18 } */
export function splitInclusiveGst(totalPaise: number, ratePercent: number) {
  const base = Math.round((totalPaise * 100) / (100 + ratePercent));
  return { base, gst: totalPaise - base };
}

/** "199.5" / "199.50" / "-12" -> paise, bina float rounding ke */
export function moneyToPaise(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.round(value * 100);
  const s = value.trim();
  const neg = s.startsWith("-");
  const [intPart = "0", fracPart = ""] = s.replace(/^[-+]/, "").split(".");
  const frac = (fracPart + "00").slice(0, 2);
  const third = Number(fracPart[2] ?? "0");
  let paise = Number(intPart) * 100 + Number(frac);
  if (third >= 5) paise += 1;
  return neg ? -paise : paise;
}
