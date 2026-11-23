# 01 — Features

## 1. Account aur access

- **Signup:** brand name, owner name, email aur password. Signup karte hi brand ka alag account (tenant) ban jaata hai.
- **Login / Logout:** session secure cookies se chalta hai (15 min access token, 7 din refresh token).
- **Users aur roles:**

| Role | Kya kar sakta hai |
|---|---|
| Owner | Sab kuch |
| Admin | Integrations, team, costs |
| Accountant | Costs, expenses, reports |
| Marketer | Reports dekhna |
| Viewer | Reports dekhna |

- **Super admin** (platform owner): saare brands ki list, suspend/activate, plan badalna (Phase 6).

## 2. Integrations (API / Webhook)

| Category | Providers | Data |
|---|---|---|
| Store | Shopify (multiple stores) | Orders, refunds, products, variants, Shopify cost per item, payment gateway, UTM |
| Ads | Meta Ads, Google Ads | Daily spend, impressions, clicks, purchases (campaign level) |
| Courier (aggregator) | Shiprocket, NimbusPost, iThink, Shipway, ClickPost | Freight, COD charge, RTO, weight discrepancy, COD remittance, NDR |
| Courier (direct) | Delhivery, Bluedart, Xpressbees, Ecom Express, Shadowfax, DTDC | Freight, COD, RTO, tracking |
| Payment | Razorpay, Cashfree, PayU, PhonePe, CCAvenue, Easebuzz, Paytm, GoKwik, Stripe, Shopify Payments, Other | Gateway fee, GST on fee, settlement |

Integrations ke features:
- Credentials **AES-256-GCM encrypted** save hote hain; screen par sirf `••••1234` dikhta hai.
- Har integration ka unique **webhook URL**.
- **Test connection**, **Sync now**, **Register webhooks** buttons, aur sync ka status/progress.

## 3. Cost categories (P&L mein kya-kya judega)

### Variable (per order)
| Cost | Source |
|---|---|
| COGS (product purchase cost) | Manual / CSV per SKU (effective-date history) · fallback: Shopify "Cost per item" |
| Packing (per unit) | Manual per SKU: bottle, pouch, sticker |
| Packing (per order) | Brand setting: box, tape, bubble wrap, label, invoice, insert card |
| Forward shipping (prepaid / COD) | Courier API |
| COD charge | Courier API |
| RTO charge | Courier API |
| Reverse pickup | Courier API |
| Weight discrepancy | Courier API / invoice CSV |
| Payment gateway fee + GST | Gateway API / fee rule |
| Checkout app fee (GoKwik etc.) | Fee rule |
| Discounts | Shopify |
| Refunds / returns | Shopify |
| Replacement order cost | Shopify tag |
| Damaged / expired stock | Manual |

### Marketing
| Cost | Source |
|---|---|
| Meta Ads spend | Meta API |
| Google Ads spend | Google Ads API |
| Marketing employee commission | Marketing Team rules (₹/order, % revenue, % ad spend, % profit) |
| Marketing employee fixed salary | Marketing Team |
| Influencer / UGC / agency / creatives | Expenses (manual) |
| WhatsApp / SMS / Email marketing | Expenses (manual) |

### Fixed (monthly)
Rent, employee salary, bijli bill, internet, Shopify plan, Shopify apps, AI tools, Google Workspace, domain, CA fee, warehouse, accounting software, support tools, licenses (AYUSH/FSSAI), trademark, bank charges, loan interest, insurance, office supplies, travel.

Expenses ke features: **recurring entry** (har mahine apne aap), category, GST input amount, aur attachment (bill photo).

### GST
- Output GST: sale par collect hua (Shopify tax lines se).
- Input Tax Credit: ads, shipping, packing, COGS aur software par diya hua GST.
- Net GST payable = Output − ITC.
- P&L mein revenue **GST ke bina** dikhta hai.

## 4. Profit formula

```
Gross Sales − Discounts − Refunds − Output GST        = NET REVENUE
NET REVENUE − COGS − Packing                          = CM1 (Gross Profit)
CM1 − Shipping (fwd + COD + RTO + reverse + weight)
    − Gateway fee − Checkout fee                      = CM2
CM2 − Marketing (Meta + Google + commission + salary) = CM3
CM3 − Fixed costs                                     = NET PROFIT
```

## 5. Dashboard (home)

- **KPI cards:** Net Revenue, Orders, AOV, Net Profit, Profit %, Ad Spend, ROAS, MER, POAS, CAC, Marketing cost/order, Delivery cost/order, RTO %
- **Comparison:** pichhle period ke against ↑↓ %
- **Charts:** revenue vs profit (daily), cost breakdown donut, P&L waterfall, Meta vs Google spend
- **Cash flow:** COD remittance pending, gateway settlement pending
- **Setup checklist** (jab tak sab connect na ho)

## 6. Reports

| Report | Details |
|---|---|
| **P&L Statement** | Daily / weekly / monthly / yearly; CM1→CM3→Net; Excel/PDF export |
| **Orders** | Har order ka revenue, COGS, packing, shipping, fee, marketing share, profit |
| **Product / SKU P&L** | Units, revenue, COGS, margin; loss-making SKUs highlight |
| **Delivery Cost Report** | Neeche detail mein |
| **Marketing Report** | Platform/campaign spend, ROAS, break-even ROAS, cost per order, employee commission payout |
| **GST Report** | Output, ITC, net payable (monthly) |
| **Expense Report** | Category-wise fixed + variable |
| **Returns / RTO Report** | Reason-wise, product-wise, pincode-wise |
| **Customer Report** | New vs repeat, AOV, LTV, cohort |

### Delivery Cost Report (main requirement)
- **Week-wise aur month-wise per-order delivery cost**
- Total dispatch charge
- **Prepaid** orders ka dispatch cost (total + per order)
- **COD** orders ka dispatch cost (total + per order)
- **COD charges** (total + per COD order)
- **RTO charges** (total, count, RTO %)
- Reverse pickup, weight discrepancy
- Courier-wise comparison: cost/order, RTO %, delivery time
- State / zone / pincode-wise RTO heatmap
- (Optional) Invoice CSV upload: API estimate vs actual bill ka difference

### Filters (har report mein)
Date range (Today, Yesterday, 7D, 30D, This month, Last month, Custom) · Store · Payment mode (Prepaid / COD / Partial COD) · Order status (Delivered / RTO / Cancelled / In-transit / Returned) · Courier · State / Zone / Pincode · Product / SKU · UTM source (Meta / Google / Organic) · Discount code · Weight slab · New / Repeat customer

## 7. Marketing Team (commission)

- 1–10 members; har member ke platforms (Meta / Google)
- Commission types: **₹ per order**, **% of net revenue**, **% of ad spend**, **% of contribution profit**, ya none
- Kin orders par: sabhi orders / sirf Meta-attributed / sirf Google-attributed (UTM se)
- Monthly fixed salary
- Report: har member ka monthly payout

## 8. Alerts aur automation (Phase 6)

- Daily P&L summary email (WhatsApp later)
- Alerts: RTO % badha, ROAS break-even se neeche gaya, COGS missing SKUs, integration error, ad spend limit cross
- High-RTO pincodes par COD band karne ka suggestion
- Audit log: kisne kaunsa cost badla
