/**
 * Integration provider registry.
 * Frontend isi se form banata hai, backend isi se validate + encrypt karta hai.
 * Naya provider add karna ho to sirf yahan entry add karo.
 */

export type IntegrationCategory = "store" | "ads" | "shipping" | "payment";

export type FieldType = "text" | "password" | "url" | "number" | "select";

export interface ProviderField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** secret = DB mein encrypted, API response mein masked */
  secret?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

export interface ProviderDef {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** Aggregator (Shiprocket jaise) ya direct courier */
  kind?: "aggregator" | "direct";
  fields: ProviderField[];
  /** Provider webhook bhejta hai to hum URL dikhayenge */
  supportsWebhook?: boolean;
  docsUrl?: string;
  /** API sync implement ho chuka hai (test + sync buttons). Baaki couriers CSV import se. */
  capabilities?: { test?: boolean; sync?: boolean; registerWebhooks?: boolean };
  /** UI mein dikhane ke liye setup note */
  setupNote?: string;
}

/** Meta/Google India ad spend par 18% GST lagta hai (ITC claim hota hai) — cost ex-GST, GST alag */
const AD_GST_FIELD: ProviderField = {
  key: "gstOnSpend",
  label: "Ad spend par GST lagta hai?",
  type: "select",
  defaultValue: "yes",
  options: [
    { value: "yes", label: "Haan — 18% GST (India billing)" },
    { value: "no", label: "Nahi" },
  ],
};

/** Courier charges GST ke saath aate hain ya bina — report ex-GST cost + GST (ITC) alag dikhata hai */
const COURIER_GST_FIELDS: ProviderField[] = [
  {
    key: "chargesIncludeGst",
    label: "API charges mein GST included hai?",
    type: "select",
    defaultValue: "no",
    options: [
      { value: "no", label: "Nahi — 18% GST upar se lagta hai" },
      { value: "yes", label: "Haan — charges GST ke saath hain" },
    ],
  },
];

const ENV_FIELD: ProviderField = {
  key: "environment",
  label: "Environment",
  type: "select",
  required: true,
  defaultValue: "production",
  options: [
    { value: "production", label: "Production" },
    { value: "sandbox", label: "Sandbox / Test" },
  ],
};

/** Har payment gateway par manual fee rule — API se fee na mile to ye use hoga */
const GATEWAY_FEE_FIELDS: ProviderField[] = [
  {
    key: "feePercent",
    label: "Gateway fee %",
    type: "number",
    defaultValue: "2",
    help: "API se actual fee na mile to ye % lagega (e.g. 2)",
  },
  {
    key: "fixedFee",
    label: "Fixed fee per txn (₹)",
    type: "number",
    defaultValue: "0",
  },
  {
    key: "gstOnFeePercent",
    label: "GST on fee %",
    type: "number",
    defaultValue: "18",
  },
];

const WEBHOOK_SECRET: ProviderField = {
  key: "webhookSecret",
  label: "Webhook secret",
  type: "password",
  secret: true,
  help: "Webhook signature verify karne ke liye",
};

export const PROVIDERS: ProviderDef[] = [
  // ───────────── STORE ─────────────
  {
    id: "shopify",
    name: "Shopify",
    category: "store",
    description: "Orders, refunds, products, customers, transactions",
    supportsWebhook: true,
    capabilities: { test: true, sync: true, registerWebhooks: true },
    docsUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
    fields: [
      { key: "shopDomain", label: "Shop domain", type: "text", required: true, placeholder: "mystore.myshopify.com" },
      { key: "adminAccessToken", label: "Admin API access token", type: "password", required: true, secret: true, placeholder: "shpat_..." },
      { key: "apiKey", label: "API key", type: "text" },
      { key: "apiSecretKey", label: "API secret key", type: "password", secret: true, help: "Webhook HMAC verify ke liye zaroori" },
      { key: "apiVersion", label: "API version", type: "text", defaultValue: "2025-10" },
    ],
  },

  // ───────────── ADS ─────────────
  {
    id: "meta_ads",
    name: "Meta Ads (Facebook / Instagram)",
    category: "ads",
    description: "Daily spend, impressions, clicks, purchases (Insights API)",
    docsUrl: "https://developers.facebook.com/docs/marketing-api/insights",
    capabilities: { test: true, sync: true },
    setupNote: "Business Settings → System users → token generate karo (ads_read permission) aur ad account assign karo.",
    fields: [
      { key: "adAccountId", label: "Ad account ID", type: "text", required: true, placeholder: "act_1234567890", help: "Multiple ho to comma se alag karo" },
      { key: "accessToken", label: "System user access token", type: "password", required: true, secret: true },
      { key: "appId", label: "App ID", type: "text" },
      { key: "appSecret", label: "App secret", type: "password", secret: true },
      { key: "businessId", label: "Business Manager ID", type: "text" },
      { key: "apiVersion", label: "Graph API version", type: "text", defaultValue: "v23.0", help: "Meta purana version band kare to badlo" },
      AD_GST_FIELD,
    ],
  },
  {
    id: "google_ads",
    name: "Google Ads",
    category: "ads",
    description: "Daily cost, clicks, conversions (Search, PMax, YouTube)",
    docsUrl: "https://developers.google.com/google-ads/api/docs/first-call/overview",
    capabilities: { test: true, sync: true },
    setupNote: "Developer token (Basic access) approve hona chahiye. Refresh token OAuth Playground / apne OAuth client se banao (scope: adwords).",
    fields: [
      { key: "customerId", label: "Customer ID", type: "text", required: true, placeholder: "123-456-7890", help: "Multiple ho to comma se alag karo" },
      { key: "loginCustomerId", label: "Manager (MCC) customer ID", type: "text" },
      { key: "developerToken", label: "Developer token", type: "password", required: true, secret: true },
      { key: "clientId", label: "OAuth client ID", type: "text", required: true },
      { key: "clientSecret", label: "OAuth client secret", type: "password", required: true, secret: true },
      { key: "refreshToken", label: "OAuth refresh token", type: "password", required: true, secret: true },
      { key: "apiVersion", label: "Google Ads API version", type: "text", defaultValue: "v22", help: "Google purana version sunset kare to badlo" },
      AD_GST_FIELD,
    ],
  },

  // ───────────── SHIPPING (aggregators) ─────────────
  {
    id: "shiprocket",
    name: "Shiprocket",
    category: "shipping",
    kind: "aggregator",
    description: "Freight, COD charge, RTO, weight discrepancy, COD remittance",
    supportsWebhook: true,
    capabilities: { test: true, sync: true },
    setupNote:
      "Shiprocket → Settings → API → Webhooks mein upar wala URL daalo aur wahi token 'x-api-key' mein daalo jo yahan 'Webhook token' mein hai.",
    fields: [
      { key: "email", label: "API user email", type: "text", required: true, help: "Shiprocket → Settings → API → Create API user" },
      { key: "password", label: "API user password", type: "password", required: true, secret: true },
      { key: "webhookToken", label: "Webhook token (x-api-key)", type: "password", secret: true, help: "Koi bhi random string — Shiprocket webhook settings mein same daalna" },
      ...COURIER_GST_FIELDS,
    ],
  },
  {
    id: "nimbuspost",
    name: "NimbusPost",
    category: "shipping",
    kind: "aggregator",
    description: "Shipments, charges, NDR, remittance",
    supportsWebhook: true,
    fields: [
      { key: "email", label: "Email", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true, secret: true },
    ],
  },
  {
    id: "ithink",
    name: "iThink Logistics",
    category: "shipping",
    kind: "aggregator",
    description: "Shipments, charges, remittance",
    fields: [
      { key: "accessToken", label: "Access token", type: "password", required: true, secret: true },
      { key: "secretKey", label: "Secret key", type: "password", required: true, secret: true },
    ],
  },
  {
    id: "shipway",
    name: "Shipway",
    category: "shipping",
    kind: "aggregator",
    description: "Shipments & tracking",
    fields: [
      { key: "username", label: "Username / Email", type: "text", required: true },
      { key: "licenseKey", label: "License key", type: "password", required: true, secret: true },
    ],
  },
  {
    id: "clickpost",
    name: "ClickPost",
    category: "shipping",
    kind: "aggregator",
    description: "Multi-carrier tracking & charges",
    supportsWebhook: true,
    fields: [
      { key: "username", label: "Username", type: "text", required: true },
      { key: "apiKey", label: "API key", type: "password", required: true, secret: true },
    ],
  },

  // ───────────── SHIPPING (direct couriers) ─────────────
  {
    id: "delhivery",
    name: "Delhivery (Direct)",
    category: "shipping",
    kind: "direct",
    description: "Direct B2C account: tracking + charges (rate API se estimate; invoice CSV se actual)",
    capabilities: { test: true, sync: true },
    setupNote:
      "AWB numbers Shopify fulfillment tracking se aate hain (tracking company 'Delhivery'). Charges Delhivery rate API se estimate hote hain — actual bill ke liye invoice CSV upload karo.",
    fields: [
      { key: "apiToken", label: "API token", type: "password", required: true, secret: true },
      { key: "clientName", label: "Client name", type: "text", required: true },
      { key: "pickupPincode", label: "Pickup (warehouse) pincode", type: "text", required: true, help: "Charges estimate ke liye" },
      { key: "pickupLocation", label: "Default pickup location", type: "text" },
      {
        key: "mode",
        label: "Default mode",
        type: "select",
        defaultValue: "S",
        options: [
          { value: "S", label: "Surface" },
          { value: "E", label: "Express" },
        ],
      },
      ENV_FIELD,
      ...COURIER_GST_FIELDS,
    ],
  },
  {
    id: "bluedart",
    name: "Blue Dart (Direct)",
    category: "shipping",
    kind: "direct",
    description: "Direct account via Blue Dart API gateway",
    fields: [
      { key: "loginId", label: "Login ID", type: "text", required: true },
      { key: "licenseKey", label: "License key", type: "password", required: true, secret: true },
      { key: "customerCode", label: "Customer code", type: "text", required: true },
      { key: "clientId", label: "API gateway client ID", type: "text" },
      { key: "clientSecret", label: "API gateway client secret", type: "password", secret: true },
    ],
  },
  {
    id: "xpressbees",
    name: "Xpressbees (Direct)",
    category: "shipping",
    kind: "direct",
    description: "Direct account",
    fields: [
      { key: "email", label: "Email / Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true, secret: true },
    ],
  },
  {
    id: "ecom_express",
    name: "Ecom Express (Direct)",
    category: "shipping",
    kind: "direct",
    description: "Direct account",
    fields: [
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true, secret: true },
    ],
  },
  {
    id: "shadowfax",
    name: "Shadowfax (Direct)",
    category: "shipping",
    kind: "direct",
    description: "Direct account",
    fields: [{ key: "apiToken", label: "API token", type: "password", required: true, secret: true }],
  },
  {
    id: "dtdc",
    name: "DTDC (Direct)",
    category: "shipping",
    kind: "direct",
    description: "Direct account",
    fields: [
      { key: "customerCode", label: "Customer code", type: "text", required: true },
      { key: "apiKey", label: "API key", type: "password", required: true, secret: true },
    ],
  },

  // ───────────── PAYMENT GATEWAYS ─────────────
  {
    id: "shopify_payments",
    name: "Shopify Payments / Shopify transactions",
    category: "payment",
    description: "Shopify connection se gateway transactions aa jaate hain — sirf fee rule set karo",
    fields: [...GATEWAY_FEE_FIELDS],
  },
  {
    id: "razorpay",
    name: "Razorpay",
    category: "payment",
    description: "Payments, fee + GST on fee, settlements",
    supportsWebhook: true,
    fields: [
      { key: "keyId", label: "Key ID", type: "text", required: true, placeholder: "rzp_live_..." },
      { key: "keySecret", label: "Key secret", type: "password", required: true, secret: true },
      WEBHOOK_SECRET,
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "cashfree",
    name: "Cashfree",
    category: "payment",
    description: "Payments, settlements",
    supportsWebhook: true,
    fields: [
      { key: "clientId", label: "App ID / Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Secret key", type: "password", required: true, secret: true },
      ENV_FIELD,
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "payu",
    name: "PayU",
    category: "payment",
    description: "Payments, settlements",
    supportsWebhook: true,
    fields: [
      { key: "merchantKey", label: "Merchant key", type: "text", required: true },
      { key: "merchantSalt", label: "Merchant salt", type: "password", required: true, secret: true },
      { key: "clientId", label: "Client ID (settlement API)", type: "text" },
      { key: "clientSecret", label: "Client secret (settlement API)", type: "password", secret: true },
      ENV_FIELD,
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "phonepe",
    name: "PhonePe PG",
    category: "payment",
    description: "Payments, settlements",
    supportsWebhook: true,
    fields: [
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client secret", type: "password", required: true, secret: true },
      { key: "clientVersion", label: "Client version", type: "text", defaultValue: "1" },
      { key: "merchantId", label: "Merchant ID", type: "text" },
      ENV_FIELD,
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "ccavenue",
    name: "CCAvenue",
    category: "payment",
    description: "Payments",
    fields: [
      { key: "merchantId", label: "Merchant ID", type: "text", required: true },
      { key: "accessCode", label: "Access code", type: "text", required: true },
      { key: "workingKey", label: "Working key", type: "password", required: true, secret: true },
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "easebuzz",
    name: "Easebuzz",
    category: "payment",
    description: "Payments, settlements",
    fields: [
      { key: "merchantKey", label: "Merchant key", type: "text", required: true },
      { key: "salt", label: "Salt", type: "password", required: true, secret: true },
      ENV_FIELD,
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "paytm",
    name: "Paytm PG",
    category: "payment",
    description: "Payments",
    fields: [
      { key: "merchantId", label: "Merchant ID (MID)", type: "text", required: true },
      { key: "merchantKey", label: "Merchant key", type: "password", required: true, secret: true },
      ENV_FIELD,
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "gokwik",
    name: "GoKwik",
    category: "payment",
    description: "Checkout + COD/prepaid; per-order checkout fee",
    fields: [
      { key: "merchantId", label: "Merchant ID", type: "text", required: true },
      { key: "appId", label: "App ID", type: "text" },
      { key: "appSecret", label: "App secret", type: "password", secret: true },
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "payment",
    description: "International payments",
    supportsWebhook: true,
    fields: [
      { key: "secretKey", label: "Secret key", type: "password", required: true, secret: true, placeholder: "sk_live_..." },
      WEBHOOK_SECRET,
      ...GATEWAY_FEE_FIELDS,
    ],
  },
  {
    id: "other_gateway",
    name: "Other gateway (manual fee)",
    category: "payment",
    description: "Koi bhi gateway jiska API nahi hai — sirf fee rule se calculate",
    fields: [
      { key: "gatewayName", label: "Gateway name", type: "text", required: true, help: "Shopify order mein jo gateway naam aata hai wahi likho" },
      ...GATEWAY_FEE_FIELDS,
    ],
  },
];

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  store: "Store",
  ads: "Ads / Marketing",
  shipping: "Shipping / Courier",
  payment: "Payment gateway",
};

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
