# ProfitLens — Project Documentation

Multi-vendor D2C Profit & Loss platform. Har brand (Jagat Pharma, Hinduja, Tatly, Kama Ayurveda…) signup karke apna Shopify store, Meta/Google Ads, courier partners aur payment gateways jodta hai, aur use **har order, har din, har mahine ka asli profit/loss** dikhta hai.

> Naam "ProfitLens" abhi placeholder hai.

## Documents

| # | File | Kya hai |
|---|---|---|
| 1 | [01-features.md](01-features.md) | Platform ke saare features: dashboard, reports, filters, cost categories |
| 2 | [02-development-phases.md](02-development-phases.md) | Development kitne phases mein hoga, har phase mein kya banega, aur status |
| 3 | [03-architecture.md](03-architecture.md) | Tech stack, folder structure, data model, formulas, security |
| 4 | [04-shopify-setup.md](04-shopify-setup.md) | Shopify custom app token kaise banaye (vendor ke liye guide) |
| 5 | [05-courier-setup.md](05-courier-setup.md) | Shiprocket / Delhivery connect + courier CSV import + hisaab ke rules |
| 6 | [06-ads-setup.md](06-ads-setup.md) | Meta / Google Ads connect, marketing team commission, marketing cost per order |

## Quick summary

- **Stack:** Vite + React 19 + TypeScript + Tailwind v4 (shadcn-style) · Node.js + Express 5 + Mongoose · MongoDB Atlas · Zod
- **Multi-tenant:** har brand ka data `tenantId` se poori tarah alag rehta hai
- **Integrations:** Shopify · Meta Ads · Google Ads · Shiprocket, Delhivery, NimbusPost, iThink, Shipway, ClickPost, Bluedart, Xpressbees, Ecom Express, Shadowfax, DTDC · Razorpay, Cashfree, PayU, PhonePe, CCAvenue, Easebuzz, Paytm, GoKwik, Stripe
- **Development:** 6 phases (~11–13 hafte)

## Decisions (final)

| Topic | Decision |
|---|---|
| Shopify connection | Abhi per-store **custom app token**, baad mein public OAuth app |
| Courier | Ek brand ke **multiple** courier ho sakte hain (aggregator + direct dono) |
| Payment gateway | Koi bhi; har gateway par manual fee rule fallback |
| "Commission" | Ads chalane wale marketing employees (1–10), commission rules ke saath |
| Product-wise ad spend | Nahi; marketing cost **per order** nikalega (total marketing ÷ orders) |
| Courier invoice CSV reconciliation | Optional feature (Phase 3) |
| Language | TypeScript, frontend aur backend dono mein |
| Paisa | Hamesha **paise (integer)** mein store hota hai |
| Timezone | Asia/Kolkata (IST) |
