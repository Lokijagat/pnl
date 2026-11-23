# 02 — Development Phases

Development **6 phases** mein hoga. Har phase ke end par working software milega jo test ho sakta hai.

| Phase | Naam | Time (approx) | Status |
|---|---|---|---|
| 1 | Foundation: auth, multi-tenant, integrations setup | 1–2 hafte | ✅ Done |
| 2 | Shopify sync + Products & COGS + Orders | 2–3 hafte | ✅ Done (real store test pending) |
| 3 | Courier integrations + Delivery Cost Report | 2 hafte | ✅ Done (real courier test pending) |
| 4 | Meta + Google Ads + Marketing cost | 2 hafte | ✅ Done (real ad accounts test pending) |
| 5 | Expenses, GST, payment gateway fees, full P&L + Dashboard | 2 hafte | ⏳ |
| 6 | Exports, alerts, super-admin, production deploy | 2 hafte | ⏳ |

**Total: ~11–13 hafte**

> **Abhi se apply kar dein** (approval mein time lagta hai): Google Ads **Developer Token** (1–3 hafte), Meta **App Review** (`ads_read`), Shopify **Partner account** (public app ke liye).

---

## Phase 1 — Foundation ✅

**Goal:** login karke brand apna private dashboard dekhe aur integrations ke credentials save kare.

Backend
- [x] pnpm monorepo: `apps/api`, `apps/web`, `packages/shared`
- [x] Express 5 + Mongoose + TypeScript, env validation (Zod)
- [x] Models: Tenant, User, Integration, MarketingMember
- [x] Auth: signup (tenant + owner), login, refresh, logout, me (JWT httpOnly cookies, bcrypt)
- [x] Role-based permissions (owner / admin / accountant / marketer / viewer)
- [x] Tenant isolation: har query mein `tenantId`
- [x] Integration credentials AES-256-GCM encryption + masking
- [x] Provider registry: 27 providers ke fields ek jagah
- [x] Marketing team CRUD (commission rules)
- [x] Users (team) CRUD
- [x] Error handling, rate limit (auth), helmet, logging (pino)

Frontend
- [x] Vite + React 19 + Tailwind v4 + shadcn-style components
- [x] Login / Signup pages
- [x] App layout: sidebar, mobile menu
- [x] Dashboard: KPI placeholders + setup checklist
- [x] Integrations page: category tabs, dynamic forms, webhook URL copy
- [x] Marketing Team page
- [x] Users page

---

## Phase 2 — Shopify sync + Products & COGS + Orders ✅

> Code complete aur mock Shopify ke saath end-to-end test ho chuka hai (33 checks pass). **Real store par test baaki hai.**

**Goal:** Shopify ke saare orders aur products aa jaayein, har SKU ka COGS aur packing daal sakein, aur har order ka gross profit (CM1) dikhe.

Backend
- [x] Background job runner (MongoDB-backed queue, retry + backoff) — baad mein BullMQ/Redis par shift ho sakta hai
- [x] Shopify GraphQL client (throttle handling, retry)
- [x] **Test connection:** shop info + granted scopes check
- [x] **Products sync:** products + variants + Shopify "cost per item"
- [x] **Orders sync:** historical (default 365 din) + incremental (`updated_at`), resumable cursor
- [x] Order mapping: line items, discounts, tax (GST), shipping charged, refunds, payment mode (Prepaid / COD / Partial COD), gateway, shipping address (state, pincode), UTM source, new/repeat customer
- [x] **Webhooks:** register + HMAC verify + dedupe (`orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`, `products/create`, `products/update`, `products/delete`, `app/uninstalled`)
- [x] Models: Product, Variant, CostHistory, Order, Job, WebhookEvent
- [x] **Cost history:** COGS + packing per SKU with effective date; purane orders ka cost us date ke hisaab se
- [x] Order cost snapshot (COGS + packing) + recost job jab cost badle
- [x] Brand setting: per-order packing cost
- [x] APIs: products list / cost update / CSV bulk import; orders list + filters + summary

Frontend
- [x] Integrations: Test / Sync now / Register webhooks buttons + job progress
- [x] **Products & COGS page:** search, "cost missing" filter, edit cost (effective date), cost history, CSV import, per-order packing setting
- [x] **Orders page:** filters (date, payment mode, status, search), summary cards, per-order CM1

---

## Phase 3 — Courier integrations + Delivery Cost Report ✅

> Code complete aur mock Shiprocket / Delhivery / Shopify ke saath end-to-end test ho chuka hai (45 checks pass). **Real courier account par field mapping verify karna baaki hai** — har shipment ka raw payload save hota hai, taaki real data se mapping tune ho sake.

**Goal:** har order ka actual shipping cost aaye aur delivery report bane.

Backend
- [x] Courier adapter interface (common format), taaki naya courier jodna aasaan ho
- [x] Shiprocket adapter: login token cache + refresh, orders/shipments, charges breakup (freight, COD, RTO, weight discrepancy), status mapping
- [x] Delhivery direct adapter: AWB Shopify fulfillment se → Tracking API (50/call) → rate API se charges **estimate**
- [x] Shiprocket tracking webhook (x-api-key verify, dedupe); URL generic `/api/webhooks/courier/:key` (Shiprocket webhook URL mein "shiprocket" word allow nahi karta)
- [x] Shipment ↔ Shopify order matching (AWB = fulfillment tracking number, ya order name / channel order id)
- [x] Model: Shipment (courier, AWB, zone, weight, status, charges breakup, invoice charges, raw)
- [x] Normalized delivery status: booked / in transit / OFD / NDR / delivered / RTO initiated / RTO in transit / RTO delivered / lost / cancelled
- [x] RTO handling: COGS 0 (stock wapas), COD RTO revenue 0, packing + shipping loss
- [x] Order par shipping cost (ex-GST), shipping GST, courier, AWB, delivery status, **CM2**
- [x] Shopify resync courier data preserve karta hai; naye orders aane par unmatched shipments auto-match
- [x] Courier GST setting: charges GST ke saath ya bina → report ex-GST + GST (ITC) alag
- [x] Delivery report aggregation (day/week/month IST, Monday week, ship date ya order date basis)
- [x] Filters: date, payment mode, status group, courier, state, zone
- [x] Breakdowns: courier, zone, state, high-RTO pincodes
- [x] **Courier CSV import** (koi bhi courier): naye shipments + invoice reconciliation (actual vs API diff)
- [x] Scheduler: courier sync har 2 ghante (last 45 din re-sync for status/charges)
- [ ] NimbusPost / iThink / Shipway / ClickPost / Bluedart API adapters — vendors ki zarurat ke hisaab se (tab tak CSV import)
- [ ] COD remittance tracking (Phase 5 cash-flow ke saath)

Frontend
- [x] **Delivery Cost Report:** KPI cards, weekly/monthly table (per order, prepaid/order, COD/order, COD charges, RTO, weight), CSV export
- [x] Courier comparison, zone-wise, state-wise, high-RTO pincodes
- [x] Data quality alerts: charges missing, estimates, unmatched shipments
- [x] **Shipments page:** filters, unmatched view, charges source (API / estimate / invoice), invoice diff, CSV import (auto column detect)
- [x] Orders page: shipping, CM2, delivery status; order detail mein shipments
- [x] Integrations: courier Test / Sync / Full resync, setup notes

---

## Phase 4 — Meta + Google Ads + Marketing cost ✅

> Code complete aur mock Meta / Google Ads APIs ke saath end-to-end test ho chuka hai (35 checks pass; Phase 2 + 3 ke tests bhi dobara pass). **Real ad accounts par verify karna baaki hai.**

**Goal:** daily ad spend aaye aur marketing cost per order nikle.

Backend
- [x] Meta Insights API: campaign × din, multiple ad accounts, paging, 30-din chunks, rate-limit retry; purchases / purchase value (omni_purchase)
- [x] Google Ads API (GAQL searchStream): campaign × din, multiple customer IDs, MCC (login-customer-id), OAuth refresh token, API version configurable
- [x] Model: AdSpend (platform, account, campaign, din, spend, GST, impressions, clicks, purchases, value)
- [x] Ad spend par GST (18%) alag field — cost ex-GST, GST ITC
- [x] Sync: pehli baar max 365 din, phir har 3 ghante last 7 din (platform numbers baad mein update hote hain)
- [x] UTM attribution (Shopify customer journey → Meta / Google / other / direct)
- [x] Marketing team commission engine: ₹/order, % revenue, % ad spend, % profit (CM2); scope all / Meta / Google orders; fixed salary din-wise prorate
- [x] Commission eligible orders = cancelled aur RTO chhod ke
- [x] **Per-order marketing share** = us din ka (ads + commission + salary) ÷ us din ke orders → Order.marketingCost, **CM3**
- [x] Auto re-allocation: ads sync, Shopify sync, courier sync, cost change, team member change ke baad
- [x] Marketing report API: totals, day/week/month, campaigns, team payout, UTM channels
- [ ] Influencer / agency / creatives jaise manual marketing kharche (Phase 5 Expenses mein "marketing" category)

Frontend
- [x] **Marketing Report:** total marketing, marketing/order, ad spend (Meta/Google + GST), team cost, MER, platform ROAS, POAS, break-even ROAS, CM3
- [x] Weekly / monthly table + CSV export
- [x] Team payout table (commission + salary per member)
- [x] Orders by UTM channel, cost per Meta / Google order
- [x] Campaign table (spend, CTR, CPC, purchases, cost/purchase, ROAS — break-even se kam ROAS laal)
- [x] Orders page: marketing share + CM3; order detail mein bhi
- [x] Integrations: Meta / Google Test + Sync

---

## Phase 5 — Expenses, GST, gateway fees, full P&L + Dashboard

**Goal:** complete P&L aur working dashboard.

Backend
- [ ] Expenses: categories, one-time + recurring (monthly auto), GST input, attachment
- [ ] Payment gateway fees: Razorpay / Cashfree / PayU settlement APIs + fee-rule fallback
- [ ] GST: output (Shopify tax), ITC (ads, shipping, packing, expenses), net payable
- [ ] `daily_summary` pre-aggregated collection (fast dashboard)
- [ ] P&L API (daily/weekly/monthly/yearly, filters, comparison)
- [ ] Fixed cost allocation per day / per order

Frontend
- [ ] **Expenses page**
- [ ] **P&L Report** (waterfall + table)
- [ ] **Dashboard:** real KPIs, charts (Recharts / ECharts), period comparison
- [ ] **GST Report**
- [ ] **Product / SKU P&L**

---

## Phase 6 — Polish, alerts, super-admin, deploy

- [ ] Excel / PDF export (har report)
- [ ] Daily P&L email + alerts
- [ ] Audit log
- [ ] Super-admin panel (tenants list, suspend, plan)
- [ ] Email invite + forgot password
- [ ] Shopify public app (OAuth) + GDPR webhooks
- [ ] Billing / subscription plans (Razorpay Subscriptions)
- [ ] Production deploy: web (Vercel), API + worker (Railway / Render / VPS), MongoDB Atlas, Redis
- [ ] Monitoring (Sentry), backups

---

## Later (optional)
- Amazon / Flipkart / Meesho marketplace integration
- WhatsApp alerts
- Inventory value + slow-moving stock
- Budget vs actual
- Mobile-friendly PWA
