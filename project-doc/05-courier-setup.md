# 05 — Courier connect kaise karein (vendor guide)

Ek brand **multiple couriers** jod sakta hai, jaise Shiprocket aur Delhivery direct dono. Jis courier ka API abhi supported nahi hai, uska data **Shipments → Courier CSV import** se aata hai.

| Courier | Kaise aata hai | Charges |
|---|---|---|
| Shiprocket | API sync (har 2 ghante) + tracking webhook | API se (freight, COD, RTO, weight discrepancy) |
| Delhivery (direct) | AWB Shopify fulfillment se + Delhivery Tracking API | Rate API se **estimate** (actual ke liye invoice CSV) |
| Baaki sab (Bluedart, Xpressbees, Ecom, DTDC, NimbusPost…) | Courier ki MIS / invoice CSV | CSV se actual |

## Shiprocket
1. Shiprocket → **Settings → API → Configure → Create an API User**. Is user ka email aur password alag hota hai, main login wala nahi.
2. ProfitLens → **Integrations → Shipping → Shiprocket → Connect**. Ye fields daalo:
   - API user email aur password
   - **Webhook token**: koi bhi random string, jaise `kama-sr-7f3k9`
   - **GST included?**: Shiprocket charges aam taur par GST ke **bina** dikhata hai, isliye "Nahi" chuno
3. **Test** dabao, phir **Sync now**. Pehli baar max 180 din ka data aata hai, uske baad har sync mein pichhle 45 din.
4. Webhook lagane ke liye: Shiprocket → **Settings → API → Webhooks**
   - URL: ProfitLens mein dikhne wala webhook URL (`.../api/webhooks/courier/...`)
   - Token / x-api-key: wahi webhook token jo step 2 mein daala

## Delhivery (direct account)
1. Delhivery One panel → **Settings → API Setup** se API token lo.
2. ProfitLens → **Shipping → Delhivery (Direct) → Connect**. Token, client name, **pickup (warehouse) pincode** aur mode (Surface / Express) daalo.
3. Shopify mein fulfillment karte waqt **tracking company "Delhivery"** aur AWB number bharna zaroori hai. ProfitLens AWB yahin se uthata hai.
4. **Test**, phir **Sync now**.
5. Charges Delhivery rate API se **estimate** hote hain. Mahine ka invoice aane par **Shipments → Courier CSV import → "Sirf invoice reconciliation"** chuno. Isse actual charges estimate ki jagah le lenge aur farq bhi dikhega.

## Courier CSV import (koi bhi courier)
**Shipments → Courier CSV import**. Column naam apne aap pehchane jaate hain:

| Field | Ye column naam chalenge |
|---|---|
| AWB (zaroori) | awb, awb no, waybill, tracking number |
| Order | order, order id, channel order id, reference no |
| Courier | courier, courier name, carrier |
| Payment | payment mode, payment method, order type (COD/Prepaid) |
| Status | status, current status (Delivered, RTO Delivered…) |
| Date | shipped date, pickup date, manifest date |
| Zone / weight / pincode | zone · weight, charged weight (kg ya grams) · pincode |
| Charges (₹, GST ke bina) | freight · cod charges · rto charges · reverse · weight discrepancy · other · gst |

Do tarah ke import hain:
- **Shipments + charges:** naye AWB ke liye shipment bhi ban jaata hai. Ye un couriers ke liye hai jinka API nahi hai.
- **Sirf invoice reconciliation:** existing AWB par actual charges save hote hain, aur report ab estimate ki jagah actual use karti hai.

## Hisaab ke rules
- Report mein saari amounts **GST ke bina** hain. GST alag dikhta hai kyunki wo ITC mein claim hota hai.
- **Per order cost** = period ke total charges ÷ ship hue orders (cancelled shipments count nahi hote).
- **RTO %** = RTO ÷ (Delivered + RTO).
- **RTO order:** COGS 0 (maal stock mein wapas aata hai). COD RTO par revenue 0. Packing aur shipping ka nuksaan rehta hai.
- Shiprocket RTO hone par COD charge wapas kar deta hai, isliye RTO shipment par COD charge 0 maana jaata hai.
- Invoice charges ho to wahi lagte hain (actual). Nahi ho to API ke charges. Wo bhi na ho to estimate.

## Real data ke saath verify karna hai
Couriers ke API fields account ya version ke saath badal sakte hain. Har shipment ka raw response DB mein save hota hai (`shipments.raw`). Real account jodne ke baad 5–10 shipments ke charges courier panel se milao. Farq dikhe to [shiprocket.ts](../apps/api/src/integrations/courier/shiprocket.ts) / [delhivery.ts](../apps/api/src/integrations/courier/delhivery.ts) ki mapping theek karni hogi.
