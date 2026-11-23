/**
 * Delhivery direct adapter.
 * - Delhivery mein "saare shipments list karo" API nahi hai → AWBs Shopify fulfillment tracking se lete hain
 *   (tracking company "Delhivery"), phir Tracking API (50 AWB per call).
 * - Charges: Invoice/rate API se ESTIMATE (chargesSource = "estimate"). Actual bill → invoice CSV upload.
 */
import { Types } from "mongoose";
import { moneyToPaise, type DeliveryStatus, type PaymentMode } from "@pnl/shared";
import { NonRetryableError } from "../../jobs/queue";
import type { LoadedIntegration } from "../../services/integrationCreds";
import { Order } from "../../models/Order";
import { Shipment } from "../../models/Shipment";
import { parseIstDate, type NormalizedShipment } from "./common";
import type { CourierAdapter } from "./types";

function base(integ: LoadedIntegration) {
  if (process.env.NODE_ENV !== "production" && process.env.DELHIVERY_API_BASE_OVERRIDE) return process.env.DELHIVERY_API_BASE_OVERRIDE;
  return integ.config.environment === "sandbox" ? "https://staging-express.delhivery.com" : "https://track.delhivery.com";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(integ: LoadedIntegration, path: string, attempt = 0): Promise<T> {
  const token = integ.secrets.apiToken;
  if (!token) throw new NonRetryableError("Delhivery API token missing");
  const res = await fetch(`${base(integ)}${path}`, {
    headers: { Authorization: `Token ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 403) throw new NonRetryableError("Delhivery ne token reject kiya — API token check karo");
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(2000 * (attempt + 1));
    return get(integ, path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Delhivery HTTP ${res.status} on ${path.split("?")[0]}`);
  return (await res.json()) as T;
}

export function mapDelhiveryStatus(statusType?: string, status?: string): DeliveryStatus {
  const t = (statusType ?? "").toUpperCase();
  const s = (status ?? "").toUpperCase();
  if (t === "DL") return s.includes("RTO") || s.includes("RETURN") ? "rto_delivered" : "delivered";
  if (t === "RT") return "rto_in_transit";
  if (t === "CN") return "cancelled";
  if (t === "LT" || s.includes("LOST")) return "lost";
  if (t === "PP" || t === "PU" || s.includes("MANIFEST") || s === "NOT PICKED") return "booked";
  if (s.includes("RTO")) return "rto_initiated";
  if (s.includes("DISPATCHED")) return "out_for_delivery";
  if (s.includes("PENDING") && t === "UD") return "ndr";
  return "in_transit";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

function paymentModeOf(orderType?: string): PaymentMode | undefined {
  const t = (orderType ?? "").toLowerCase();
  if (!t) return undefined;
  return t.includes("cod") ? "cod" : "prepaid";
}

/** Rate API call — same combination ek sync mein ek hi baar */
async function estimate(
  integ: LoadedIntegration,
  cache: Map<string, Any | null>,
  p: { ss: "Delivered" | "RTO"; dPin: string; grams: number; pt: "COD" | "Pre-paid"; cod: number },
) {
  const oPin = integ.config.pickupPincode;
  if (!oPin || !p.dPin) return null;
  const md = integ.config.mode === "E" ? "E" : "S";
  const key = [md, p.ss, oPin, p.dPin, p.grams, p.pt, p.cod].join("|");
  if (cache.has(key)) return cache.get(key)!;
  try {
    const r = await get<Any[]>(
      integ,
      `/api/kinko/v1/invoice/charges/.json?md=${md}&ss=${p.ss}&o_pin=${oPin}&d_pin=${p.dPin}&cgm=${p.grams}&pt=${p.pt}&cod=${p.cod}`,
    );
    const row = Array.isArray(r) ? (r[0] ?? null) : null;
    cache.set(key, row);
    return row;
  } catch {
    cache.set(key, null);
    return null;
  }
}

async function mapPackage(integ: LoadedIntegration, sh: Any, cache: Map<string, Any | null>): Promise<NormalizedShipment> {
  const st = sh.Status ?? {};
  const status = mapDelhiveryStatus(st.StatusType, st.Status);
  const isRto = status.startsWith("rto");
  const pm = paymentModeOf(sh.OrderType);
  const grams = Math.max(Math.round(Number(sh.ChargedWeight) || 0), 0) || 500;
  const dPin = String(sh.Consignee?.PinCode ?? "");
  const codRupees = Number(sh.CODAmount) || 0;

  let charges: NormalizedShipment["charges"];
  let zone: string | undefined;
  if (status !== "cancelled") {
    const fwd = await estimate(integ, cache, { ss: "Delivered", dPin, grams, pt: pm === "cod" && !isRto ? "COD" : "Pre-paid", cod: isRto ? 0 : codRupees });
    if (fwd) {
      zone = fwd.zone ? String(fwd.zone).toUpperCase() : undefined;
      const gross = Number(fwd.gross_amount ?? fwd.total_amount) || 0;
      const codCh = Number(fwd.charge_COD) || 0;
      charges = { freight: moneyToPaise(gross - codCh), cod: moneyToPaise(codCh) };
      if (isRto) {
        const rt = await estimate(integ, cache, { ss: "RTO", dPin, grams, pt: "Pre-paid", cod: 0 });
        const rtoGross = Number(rt?.gross_amount ?? rt?.total_amount) || 0;
        charges.rto = moneyToPaise(Math.max(rtoGross - gross, 0));
      }
    }
  }

  return {
    externalId: String(sh.AWB),
    awb: String(sh.AWB),
    courierName: "Delhivery",
    orderRef: sh.ReferenceNo ? String(sh.ReferenceNo) : undefined,
    paymentMode: pm,
    codAmount: pm === "cod" ? moneyToPaise(codRupees) : undefined,
    isReverse: /pickup|reverse/i.test(String(sh.OrderType ?? "")) && !/cod|pre/i.test(String(sh.OrderType ?? "")),
    status,
    statusRaw: [st.StatusType, st.Status].filter(Boolean).join(" / "),
    shippedAt: parseIstDate(sh.PickUpDate ?? sh.PickedupDate),
    deliveredAt: status === "delivered" ? parseIstDate(sh.DeliveryDate ?? st.StatusDateTime) : undefined,
    rtoInitiatedAt: isRto ? parseIstDate(sh.RTOStartedDate) : undefined,
    rtoDeliveredAt: status === "rto_delivered" ? parseIstDate(sh.ReturnedDate ?? st.StatusDateTime) : undefined,
    lastStatusAt: parseIstDate(st.StatusDateTime),
    chargedWeightGrams: grams,
    zone,
    pickupPincode: integ.config.pickupPincode,
    pincode: dPin || undefined,
    city: sh.Consignee?.City ?? undefined,
    state: sh.Consignee?.State ?? undefined,
    charges,
    chargesSource: charges ? "estimate" : "none",
    raw: { Status: st, OrderType: sh.OrderType, ReferenceNo: sh.ReferenceNo, ChargedWeight: sh.ChargedWeight },
  };
}

const FINAL = ["delivered", "rto_delivered", "cancelled", "lost"];

export const delhiveryAdapter: CourierAdapter = {
  async test(integ) {
    const pin = integ.config.pickupPincode || "110001";
    const r = await get<{ delivery_codes?: unknown[] }>(integ, `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pin)}`);
    return { info: { pickupServiceable: (r.delivery_codes?.length ?? 0) > 0 } };
  },

  async sync(integ, since, onPage) {
    // Shopify fulfillments se Delhivery AWBs
    const orders = await Order.find(
      { tenantId: new Types.ObjectId(integ.tenantId), processedAt: { $gte: since }, "fulfillments.company": /delhivery/i },
      { fulfillments: 1 },
    ).lean();
    const awbs = [
      ...new Set(orders.flatMap((o) => (o.fulfillments ?? []).filter((f) => /delhivery/i.test(f.company ?? "")).map((f) => f.number!))),
    ].filter(Boolean);

    // final status + charges wale dobara track nahi karne
    const done = await Shipment.find(
      { tenantId: integ.tenantId, provider: "delhivery", awb: { $in: awbs }, status: { $in: FINAL }, chargesSource: { $ne: "none" } },
      { awb: 1 },
    ).lean();
    const skip = new Set(done.map((d) => d.awb));
    const todo = awbs.filter((a) => !skip.has(a));

    const cache = new Map<string, Any | null>();
    let count = 0;
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const r = await get<{ ShipmentData?: { Shipment: Any }[] }>(integ, `/api/v1/packages/json/?waybill=${batch.join(",")}`);
      const list: NormalizedShipment[] = [];
      for (const row of r.ShipmentData ?? []) {
        if (row.Shipment?.AWB) list.push(await mapPackage(integ, row.Shipment, cache));
      }
      await onPage(list);
      count += list.length;
    }
    return count;
  },
};
