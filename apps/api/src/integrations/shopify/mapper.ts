import type { Types } from "mongoose";
import { moneyToPaise, type OrderStatus, type PaymentMode } from "@pnl/shared";
import { amt, type GqlOrder } from "./queries";

const COD_RE = /\bcod\b|cash[\s_-]*on[\s_-]*delivery/i;

export function detectPaymentMode(gateways: string[]): PaymentMode {
  const list = gateways.filter(Boolean);
  if (!list.length) return "prepaid";
  const cod = list.filter((g) => COD_RE.test(g)).length;
  if (cod === 0) return "prepaid";
  return cod === list.length ? "cod" : "partial_cod";
}

export function detectChannel(source?: string | null, utmSource?: string | null): string {
  const s = `${utmSource ?? ""} ${source ?? ""}`.toLowerCase();
  if (/facebook|instagram|\bfb\b|\big\b|meta/.test(s)) return "meta";
  if (/google|youtube|gclid|adwords/.test(s)) return "google";
  if (utmSource) return "other";
  return "direct";
}

function deriveStatus(cancelledAt: string | null, totalPrice: number, refunded: number): OrderStatus {
  if (cancelledAt) return "cancelled";
  if (refunded > 0 && refunded >= totalPrice) return "refunded";
  if (refunded > 0) return "partially_refunded";
  return "open";
}

/** GraphQL order → Order document fields (cost snapshot alag se applyCosts mein) */
export function mapOrder(o: GqlOrder, tenantId: string, integrationId: string, variantIds: Map<string, Types.ObjectId>) {
  const totalPrice = moneyToPaise(amt(o.totalPriceSet));
  const refunded = moneyToPaise(amt(o.totalRefundedSet));
  const visit = o.customerJourneySummary?.lastVisit ?? o.customerJourneySummary?.firstVisit ?? null;
  const utm = visit?.utmParameters ?? null;

  const lineItems = o.lineItems.nodes.map((li) => {
    const unitPrice = moneyToPaise(amt(li.originalUnitPriceSet));
    const tax = li.taxLines.reduce((s, t) => s + moneyToPaise(amt(t.priceSet)), 0);
    const rate = li.taxLines.reduce((s, t) => s + (t.rate ?? 0), 0);
    return {
      shopifyId: li.id,
      variantShopifyId: li.variant?.id,
      variantId: li.variant ? variantIds.get(li.variant.id) : undefined,
      sku: li.sku ?? "",
      title: li.name,
      quantity: li.quantity,
      currentQuantity: li.currentQuantity,
      unitPrice,
      discount: moneyToPaise(amt(li.totalDiscountSet)),
      tax,
      taxRateBp: Math.round(rate * 10000),
      cogsUnit: 0,
      packingUnit: 0,
      costMissing: false,
    };
  });

  return {
    tenantId,
    integrationId,
    shopifyId: o.id,
    name: o.name,
    processedAt: new Date(o.processedAt ?? o.createdAt),
    shopifyUpdatedAt: new Date(o.updatedAt),
    cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : undefined,
    cancelReason: o.cancelReason ?? undefined,
    financialStatus: o.displayFinancialStatus ?? undefined,
    fulfillmentStatus: o.displayFulfillmentStatus ?? undefined,
    status: deriveStatus(o.cancelledAt, totalPrice, refunded),
    paymentMode: detectPaymentMode(o.paymentGatewayNames),
    gateways: o.paymentGatewayNames,
    sourceName: o.sourceName ?? undefined,
    tags: o.tags,
    currency: o.currencyCode,
    taxesIncluded: o.taxesIncluded,
    grossSales: lineItems.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    discounts: moneyToPaise(amt(o.totalDiscountsSet)),
    shippingCharged: moneyToPaise(amt(o.totalShippingPriceSet)),
    tax: moneyToPaise(amt(o.totalTaxSet)),
    totalPrice,
    refunded,
    lineItems,
    refunds: o.refunds.map((r) => ({
      shopifyId: r.id,
      createdAt: new Date(r.createdAt),
      amount: moneyToPaise(amt(r.totalRefundedSet)),
      lines: r.refundLineItems.nodes.map((n) => ({
        lineItemShopifyId: n.lineItem?.id,
        quantity: n.quantity,
        subtotal: moneyToPaise(amt(n.subtotalSet)),
      })),
    })),
    fulfillments: (o.fulfillments ?? []).flatMap((f) =>
      f.trackingInfo
        .filter((t) => t.number)
        .map((t) => ({ company: t.company ?? undefined, number: t.number!.trim(), createdAt: new Date(f.createdAt), status: f.displayStatus ?? undefined })),
    ),
    shipping: {
      city: o.shippingAddress?.city ?? undefined,
      state: o.shippingAddress?.province ?? undefined,
      stateCode: o.shippingAddress?.provinceCode ?? undefined,
      pincode: o.shippingAddress?.zip?.replace(/\s/g, "") ?? undefined,
      country: o.shippingAddress?.countryCodeV2 ?? undefined,
    },
    customer: o.customer
      ? { shopifyId: o.customer.id, ordersCount: Number(o.customer.numberOfOrders) || 0 }
      : undefined,
    utm: {
      source: utm?.source ?? visit?.source ?? undefined,
      medium: utm?.medium ?? undefined,
      campaign: utm?.campaign ?? undefined,
      channel: detectChannel(visit?.source, utm?.source),
    },
  };
}
