# ProfitLens — Multi-vendor D2C P&L

Shopify + Meta + Google Ads + couriers + payment gateways → har brand ka real profit/loss.

## Structure
```
apps/api        Express 5 + Mongoose + TypeScript   (port 4000)
apps/web        Vite + React 19 + Tailwind v4        (port 5173, /api proxy)
packages/shared Zod schemas, roles, money helpers, integration provider registry
```

## Setup
```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # MONGODB_URI (Atlas) + secrets bharo
pnpm dev                                  # api + web dono
```
Secrets generate karne ke liye:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
`ENCRYPTION_KEY` ek baar set karne ke baad **kabhi mat badlo**, warna saved tokens decrypt nahi honge.

## Rules
- Paisa hamesha **paise (integer)** mein store karo, aur percent **basis points** mein.
- Har tenant-data query mein `tenantId: req.auth.tid` hona zaroori hai.
- Naya provider jodna ho to [packages/shared/src/providers.ts](packages/shared/src/providers.ts) mein entry add karo. UI form aur backend validation apne aap ban jaayenge.

## Phases
1. ✅ Auth, multi-tenant, roles, integrations (credentials), marketing team, users
2. ✅ Shopify sync + webhooks, products COGS/packing, orders (CM1)
3. ✅ Courier sync (Shiprocket, Delhivery + CSV import), Delivery Cost Report (CM2)
4. ✅ Meta + Google Ads, team commission, marketing cost per order (CM3), Marketing Report
5. ⏳ Expenses, GST, payment gateway fees, full P&L, dashboard
6. ⏳ Exports, alerts, super-admin, production deploy

Poori documentation: [project-doc/](project-doc/README.md)
