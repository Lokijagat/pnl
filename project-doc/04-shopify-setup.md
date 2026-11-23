# 04 — Shopify connect kaise karein (vendor guide)

Abhi har store ek **custom app** bana ke uska token ProfitLens mein daalta hai.

## Step 1: custom app banao
1. Shopify Admin → **Settings → Apps and sales channels → Develop apps**
2. Pehli baar ho to **Allow custom app development** par click karo
3. **Create an app**, naam do `ProfitLens`

## Step 2: API scopes do
**Configuration → Admin API integration → Configure**, aur ye scopes tick karo:

| Scope | Kyun |
|---|---|
| `read_orders` | Orders, refunds, transactions |
| `read_all_orders` | 60 din se purane orders (agar list mein dikhe) |
| `read_products` | Products, variants |
| `read_inventory` | Shopify "Cost per item" (fallback COGS) |
| `read_customers` | New vs repeat customer |

Save karo.

## Step 3: install aur token copy karo
1. **API credentials → Install app**
2. **Admin API access token** ek baar hi dikhta hai (`shpat_...`), use copy karo
3. **API secret key** bhi copy karo (webhook verify ke liye)

## Step 4: ProfitLens mein daalo
1. **Integrations → Store → Shopify → Connect**
2. Shop domain (`mystore.myshopify.com`), Admin API access token aur API secret key daalo, phir Save
3. **Test** dabao. Status "Connected" hona chahiye; koi scope missing ho to wahi dikhega
4. **Sync now** dabao. Pehle products aayenge, phir orders (default pichhle 365 din)
5. **Webhooks** dabao, taaki naye orders real-time aayein (iske liye server ka public URL chahiye)

## Agla kaam
**Products & COGS** page par har SKU ka purchase cost aur packing cost daalo (ya CSV upload karo), aur per-order packing cost (box, tape, label) set karo.
