/** Shopify Admin GraphQL queries (API 2025-10) */

const money = "shopMoney { amount }";

export const SHOP_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop { name myshopifyDomain currencyCode ianaTimezone plan { displayName } }
    currentAppInstallation { accessScopes { handle } }
  }
`;

const PRODUCT_FIELDS = /* GraphQL */ `
  fragment ProductFields on Product {
    id title status vendor productType
    featuredMedia { preview { image { url } } }
    variants(first: 100) {
      nodes { id sku title price inventoryItem { unitCost { amount } } }
    }
  }
`;

export const PRODUCTS_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ...ProductFields }
    }
  }
`;

export const PRODUCT_BY_ID = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query Product($id: ID!) { product(id: $id) { ...ProductFields } }
`;

/** read_customers scope na ho to customer field skip */
function orderFields(withCustomer: boolean) {
  return /* GraphQL */ `
  fragment OrderFields on Order {
    id name processedAt createdAt updatedAt cancelledAt cancelReason
    displayFinancialStatus displayFulfillmentStatus
    paymentGatewayNames tags sourceName currencyCode taxesIncluded
    subtotalPriceSet { ${money} }
    totalDiscountsSet { ${money} }
    totalShippingPriceSet { ${money} }
    totalTaxSet { ${money} }
    totalPriceSet { ${money} }
    totalRefundedSet { ${money} }
    shippingAddress { city province provinceCode zip countryCodeV2 }
    ${withCustomer ? "customer { id numberOfOrders }" : ""}
    customerJourneySummary {
      firstVisit { source utmParameters { source medium campaign } }
      lastVisit { source utmParameters { source medium campaign } }
    }
    lineItems(first: 100) {
      nodes {
        id sku name quantity currentQuantity
        variant { id }
        originalUnitPriceSet { ${money} }
        totalDiscountSet { ${money} }
        taxLines { rate priceSet { ${money} } }
      }
    }
    fulfillments(first: 10) {
      createdAt displayStatus
      trackingInfo(first: 5) { company number }
    }
    refunds(first: 50) {
      id createdAt
      totalRefundedSet { ${money} }
      refundLineItems(first: 100) { nodes { quantity lineItem { id } subtotalSet { ${money} } } }
    }
  }
`;
}

export function ordersQuery(withCustomer: boolean) {
  return /* GraphQL */ `
  ${orderFields(withCustomer)}
  query Orders($cursor: String, $query: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ...OrderFields }
    }
  }
`;
}

export function orderByIdQuery(withCustomer: boolean) {
  return /* GraphQL */ `
  ${orderFields(withCustomer)}
  query Order($id: ID!) { order(id: $id) { ...OrderFields } }
`;
}

export const WEBHOOKS_LIST = /* GraphQL */ `
  query Webhooks { webhookSubscriptions(first: 100) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }
`;

export const WEBHOOK_CREATE = /* GraphQL */ `
  mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $url: URL!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
      webhookSubscription { id topic }
      userErrors { field message }
    }
  }
`;

export const WEBHOOK_DELETE = /* GraphQL */ `
  mutation WebhookDelete($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { message } } }
`;

// ── Response types ──
type Money = { shopMoney: { amount: string } } | null;
type Utm = { source: string | null; medium: string | null; campaign: string | null } | null;
type Visit = { source: string | null; utmParameters: Utm } | null;

export interface GqlVariant {
  id: string;
  sku: string | null;
  title: string;
  price: string;
  inventoryItem: { unitCost: { amount: string } | null } | null;
}
export interface GqlProduct {
  id: string;
  title: string;
  status: string;
  vendor: string | null;
  productType: string | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: GqlVariant[] };
}

export interface GqlOrder {
  id: string;
  name: string;
  processedAt: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  paymentGatewayNames: string[];
  tags: string[];
  sourceName: string | null;
  currencyCode: string;
  taxesIncluded: boolean;
  subtotalPriceSet: Money;
  totalDiscountsSet: Money;
  totalShippingPriceSet: Money;
  totalTaxSet: Money;
  totalPriceSet: Money;
  totalRefundedSet: Money;
  shippingAddress: { city: string | null; province: string | null; provinceCode: string | null; zip: string | null; countryCodeV2: string | null } | null;
  customer?: { id: string; numberOfOrders: string } | null;
  customerJourneySummary: { firstVisit: Visit; lastVisit: Visit } | null;
  lineItems: {
    nodes: {
      id: string;
      sku: string | null;
      name: string;
      quantity: number;
      currentQuantity: number;
      variant: { id: string } | null;
      originalUnitPriceSet: Money;
      totalDiscountSet: Money;
      taxLines: { rate: number | null; priceSet: Money }[];
    }[];
  };
  fulfillments?: { createdAt: string; displayStatus: string | null; trackingInfo: { company: string | null; number: string | null }[] }[];
  refunds: {
    id: string;
    createdAt: string;
    totalRefundedSet: Money;
    refundLineItems: { nodes: { quantity: number; lineItem: { id: string } | null; subtotalSet: Money }[] };
  }[];
}

export const amt = (m: Money | undefined) => m?.shopMoney.amount ?? "0";
