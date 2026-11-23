# 03 — Architecture

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vite 6, React 19, TypeScript |
| CSS / UI | **Tailwind CSS v4** + shadcn-style components (`apps/web/src/components/ui`) |
| Icons | lucide-react |
| Data fetching | TanStack Query |
| Forms | React Hook Form + Zod |
| Routing | React Router 7 |
| Charts (Phase 5) | Recharts / Apache ECharts |
| Backend | Node.js 20+, Express 5, TypeScript |
| Database | MongoDB (Atlas) + Mongoose 8 |
| Validation | Zod (frontend aur backend same schema, `packages/shared`) |
| Jobs | MongoDB-backed job queue (Phase 2); BullMQ + Redis jab scale chahiye |
| Auth | JWT (httpOnly cookies) + bcrypt |
| Logging | pino |
| Build | tsup (API), Vite (web), pnpm workspaces |

## Folder structure

```
pnl/
├─ apps/
│  ├─ api/                  Express backend
│  │  └─ src/
│  │     ├─ config/         env validation
│  │     ├─ lib/            crypto, jwt, logger, errors
│  │     ├─ middleware/     auth, error
│  │     ├─ models/         Mongoose models
│  │     ├─ routes/         REST routes
│  │     ├─ integrations/   shopify/ (client, queries, mapper, sync) · courier/ (common, shiprocket, delhivery) · ads/ (meta, google)
│  │     ├─ jobs/           job queue + handlers
│  │     └─ services/       business logic (costing, reports)
│  └─ web/                  React frontend
│     └─ src/
│        ├─ components/ui/  Button, Input, Card, Dialog …
│        ├─ layouts/        AppLayout, AuthLayout
│        ├─ pages/          Dashboard, Orders, Products, Integrations …
│        ├─ hooks/          useAuth …
│        └─ lib/            api client, utils
├─ packages/
│  └─ shared/               Zod schemas, roles, money helpers, provider registry
└─ project-doc/             ye documentation
```

## Multi-tenancy

```
Tenant (brand)
 ├─ Users (roles)
 ├─ Integrations (Shopify ×N, couriers ×N, gateways ×N, Meta, Google)
 └─ Data: products, variants, cost history, orders, shipments, ad spend, expenses
```

- Har document mein `tenantId`; har route `authOf(req).tid` se filter karta hai.
- Ek brand doosre brand ka data na padh sakta hai, na delete kar sakta hai (Phase 1 mein test hua).

## Data model (main collections)

| Collection | Main fields |
|---|---|
| tenants | name, slug, plan, timezone, settings (packingPerOrder, syncDays) |
| users | tenantId, name, email, passwordHash, role, tokenVersion |
| integrations | tenantId, provider, category, label, config, secrets (encrypted), meta, webhookKey, status |
| marketingmembers | tenantId, platforms, commissionType, commissionValue, orderScope, monthlyFixed |
| products | tenantId, integrationId, shopifyId, title, status, imageUrl |
| variants | tenantId, productId, shopifyId, sku, title, price, shopifyUnitCost |
| costhistories | tenantId, variantId, cogs, packing, effectiveFrom |
| orders | tenantId, integrationId, shopifyId, name, processedAt, paymentMode, gateways, money fields, lineItems (with cost snapshot), refunds, address, utm, customer |
| jobs | tenantId, integrationId, type, payload, status, attempts, progress, error |
| webhookevents | provider, integrationId, topic, eventId (dedupe), status |
| shipments | tenantId, integrationId, provider, externalId, awb, courierName, orderId, paymentMode, status (normalized), dates, zone, weight, pincode/state, charges {freight, cod, rto, reverse, weightDiscrepancy, other, gst, total}, chargesSource (api/estimate/invoice), invoiceCharges, raw |
| adspends | tenantId, integrationId, platform, accountId, campaignId, campaignName, day, spend, gst, impressions, clicks, purchases, purchaseValue |
| expenses (P5) | category, amount, gst, date, recurring |
| dailysummaries (P5) | tenantId, storeId, date, all P&L totals |

## Money rules

- Saari amounts **paise (integer)** mein: ₹199.50 → `19950`
- Percent **basis points** mein: 2.5% → `250`
- Shopify ka money string (`"199.50"`) bina float ke paise mein convert hota hai (`moneyToPaise`).
- Order ka cost **snapshot** order mein save hota hai. Cost history effective-date wise hai, isliye recalculation consistent rehta hai.

## Order cost logic (Phase 2)

```
Line COGS    = cost_history(variant, order date).cogs    ?? Shopify cost per item ?? 0 (missing flag)
Line packing = cost_history(variant, order date).packing ?? 0
Order packing = Σ(line packing × qty) + tenant.settings.packingPerOrder
Net revenue (ex-GST) = (total price − refunded) × (1 − tax / total price)
CM1 = Net revenue − COGS − Packing
```

## Shipping / RTO logic (Phase 3)

```
Shipment charges   = invoice (actual) ?? API ?? estimate    — sab ex-GST, GST alag
Order.shippingCost = Σ shipment charges (forward + RTO + reverse)
RTO order          → COGS 0, COD revenue 0, packing + shipping loss
CM2                = CM1 − shippingCost
```

Matching: shipment.awb = Shopify fulfillment tracking number, warna courier order ref = Shopify order name / id.

## Marketing logic (Phase 4)

```
Din ka marketing    = Meta + Google spend + team commission + team salary/din   (ex-GST)
Order.marketingCost = din ka marketing ÷ us din ke non-cancelled orders
CM3                 = CM2 − marketingCost
```

Commission ke liye eligible orders = cancelled aur RTO chhod ke. Engine: `apps/api/src/services/marketing.ts` (`computeDaily`, `allocateMarketing`).

## Payment mode detection

| Shopify gateway names | Mode |
|---|---|
| Sirf COD ("Cash on Delivery (COD)", "cod", "cash_on_delivery") | COD |
| COD + koi prepaid gateway | Partial COD |
| Koi bhi aur gateway | Prepaid |

## Webhooks

- `/api/webhooks/:provider/:webhookKey`, raw body (HMAC ke liye `express.json` se pehle mount)
- Shopify: `X-Shopify-Hmac-Sha256` verify (app API secret key se), `X-Shopify-Webhook-Id` se dedupe
- Webhook turant `200` return karta hai, aur processing job queue mein hoti hai (order GraphQL se re-fetch)
- Local development mein webhooks ke liye public URL chahiye (cloudflared / ngrok), aur `PUBLIC_API_URL` us URL par set hona chahiye

## Security

- Secrets AES-256-GCM encrypted (`ENCRYPTION_KEY`, ek baar set karke kabhi mat badlo)
- httpOnly cookies, refresh token revoke (`tokenVersion`)
- Auth rate limit, helmet headers, Zod validation har input par
- Role-based permissions (`packages/shared/src/roles.ts`)
