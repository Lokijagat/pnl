/**
 * Shiprocket adapter — https://apiv2.shiprocket.in/v1/external
 * NOTE: Shiprocket response fields version ke saath badalte hain. Mapping defensive hai aur
 * raw payload Shipment.raw mein save hota hai — real data aane par yahi file verify/tune karni hai.
 */
import { moneyToPaise, type DeliveryStatus } from "@pnl/shared";
import { NonRetryableError } from "../../jobs/queue";
import type { LoadedIntegration } from "../../services/integrationCreds";
import { kgToGrams, parseIstDate, type NormalizedShipment } from "./common";
import type { CourierAdapter } from "./types";

const BASE = process.env.NODE_ENV !== "production" && process.env.SHIPROCKET_API_BASE_OVERRIDE
  ? process.env.SHIPROCKET_API_BASE_OVERRIDE
  : "https://apiv2.shiprocket.in/v1/external";

const tokens = new Map<string, { token: string; exp: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(integ: LoadedIntegration): Promise<string> {
  const cached = tokens.get(integ.id);
  if (cached && cached.exp > Date.now()) return cached.token;
  const email = integ.config.email;
  const password = integ.secrets.password;
  if (!email || !password) throw new NonRetryableError("Shiprocket email/password missing");
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new NonRetryableError("Shiprocket login fail — API user email/password check karo");
  }
  if (!res.ok) throw new Error(`Shiprocket login HTTP ${res.status}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new NonRetryableError("Shiprocket ne token nahi diya");
  // token 10 din valid; 9 din cache
  tokens.set(integ.id, { token: body.token, exp: Date.now() + 9 * 86_400_000 });
  return body.token;
}

async function get<T>(integ: LoadedIntegration, path: string, attempt = 0): Promise<T> {
  const token = await login(integ);
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 && attempt === 0) {
    tokens.delete(integ.id);
    return get(integ, path, 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(2000 * (attempt + 1));
    return get(integ, path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Shiprocket HTTP ${res.status} on ${path.split("?")[0]}`);
  return (await res.json()) as T;
}

/** Shiprocket status text → normalized */
export function mapShiprocketStatus(raw?: string | null): DeliveryStatus {
  const s = (raw ?? "").toUpperCase().replace(/[_-]/g, " ").trim();
  if (!s) return "booked";
  if (s.includes("RTO")) {
    if (s.includes("DELIVERED")) return "rto_delivered";
    if (s.includes("INITIATED") || s.includes("ACKNOWLEDGED")) return "rto_initiated";
    return "rto_in_transit";
  }
  if (/CANCEL/.test(s)) return "cancelled";
  if (/LOST|DAMAGED|DESTROYED|DISPOSED/.test(s)) return "lost";
  if (s === "DELIVERED" || s.startsWith("DELIVERED")) return "delivered";
  if (s.includes("OUT FOR DELIVERY")) return "out_for_delivery";
  if (/UNDELIVERED|NDR|DELIVERY FAILED|FAILED DELIVERY|CONTACT CUSTOMER CARE/.test(s)) return "ndr";
  if (/NEW|INVOICED|READY TO SHIP|PICKUP|MANIFEST|AWB ASSIGNED|LABEL/.test(s)) return "booked";
  return "in_transit";
}

const num = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};
const paise = (v: unknown) => moneyToPaise(num(v));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

export function mapShiprocketOrder(o: Any): NormalizedShipment[] {
  const shipments: Any[] = Array.isArray(o.shipments) && o.shipments.length ? o.shipments : [{}];
  const cod = /cod/i.test(String(o.payment_method ?? ""));
  return shipments.map((s, idx) => {
    const statusRaw = String(s.status ?? o.status ?? "");
    const status = mapShiprocketStatus(statusRaw);
    const isRto = status.startsWith("rto");
    const c: Any = o.awb_data?.charges ?? s.charges ?? {};

    const applied = num(c.applied_weight_amount ?? c.freight_charges);
    const charged = num(c.charged_weight_amount);
    const freight = applied || charged;
    const weightDiscrepancy = charged > applied && applied > 0 ? charged - applied : 0;
    // Shiprocket RTO par COD charge reverse kar deta hai
    const codCharge = isRto ? 0 : num(c.cod_charges);
    const rto = isRto ? num(c.charged_weight_amount_rto ?? c.applied_weight_amount_rto ?? c.rto_charges) : 0;
    const hasCharges = freight + codCharge + rto > 0;

    const awb = String(s.awb ?? o.awb_data?.awb ?? o.awb_code ?? "").trim() || undefined;
    return {
      externalId: String(s.id ?? `${o.id}-${idx}`),
      awb,
      courierName: s.courier ?? o.courier_name ?? o.awb_data?.courier_name ?? undefined,
      orderRef: o.channel_order_id != null ? String(o.channel_order_id) : undefined,
      paymentMode: cod ? "cod" : "prepaid",
      codAmount: cod ? paise(o.total) : undefined,
      isReverse: Boolean(o.is_return) || /return/i.test(String(o.order_type ?? "")),
      status,
      statusRaw,
      shippedAt: parseIstDate(s.shipped_date ?? s.pickedup_timestamp ?? s.pickup_scheduled_date ?? s.created_at ?? o.created_at),
      deliveredAt: status === "delivered" ? parseIstDate(s.delivered_date ?? o.delivered_date) : undefined,
      rtoInitiatedAt: isRto ? parseIstDate(s.rto_initiated_date ?? o.rto_initiated_date) : undefined,
      rtoDeliveredAt: status === "rto_delivered" ? parseIstDate(s.rto_delivered_date ?? o.rto_delivered_date) : undefined,
      lastStatusAt: parseIstDate(o.updated_at ?? s.updated_at),
      weightGrams: kgToGrams(c.applied_weight ?? s.weight),
      chargedWeightGrams: kgToGrams(c.charged_weight),
      zone: c.zone ? String(c.zone).toUpperCase() : undefined,
      pincode: o.customer_pincode ? String(o.customer_pincode) : undefined,
      city: o.customer_city ?? undefined,
      state: o.customer_state ?? undefined,
      charges: hasCharges
        ? { freight: moneyToPaise(freight), cod: moneyToPaise(codCharge), rto: moneyToPaise(rto), weightDiscrepancy: moneyToPaise(weightDiscrepancy) }
        : undefined,
      chargesSource: hasCharges ? "api" : "none",
      raw: { id: o.id, channel_order_id: o.channel_order_id, status: o.status, payment_method: o.payment_method, shipment: s, charges: c },
    };
  });
}

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

export const shiprocketAdapter: CourierAdapter = {
  async test(integ) {
    tokens.delete(integ.id);
    await login(integ);
    const r = await get<{ meta?: Any }>(integ, `/orders?per_page=1&page=1`);
    return { info: { totalOrders: r.meta?.pagination?.total ?? null } };
  },

  async sync(integ, since, onPage) {
    const to = ymd(new Date());
    const from = ymd(since);
    let page = 1;
    let total = 0;
    for (;;) {
      const r = await get<{ data?: Any[]; meta?: { pagination?: { total_pages?: number } } }>(
        integ,
        `/orders?per_page=100&page=${page}&from=${from}&to=${to}`,
      );
      const rows = r.data ?? [];
      const list = rows.flatMap(mapShiprocketOrder);
      await onPage(list);
      total += rows.length;
      const pages = r.meta?.pagination?.total_pages ?? 1;
      if (page >= pages || rows.length === 0) break;
      page++;
    }
    return total;
  },
};
