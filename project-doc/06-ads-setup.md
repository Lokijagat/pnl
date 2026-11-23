# 06 — Meta / Google Ads connect + marketing cost ka hisaab

## Meta Ads (Facebook / Instagram)
1. **Business Settings → Users → System users → Add** (role: Admin ya Employee).
2. Us system user ko **Assign assets → Ad accounts** (View performance permission kaafi hai).
3. **Generate new token**. App chuno, permission **`ads_read`** do, aur expiry "Never" rakho.
4. ProfitLens → **Integrations → Ads → Meta Ads → Connect**. Ye fields daalo:
   - **Ad account ID**: `act_123…` ya sirf number. Ek se zyada account ho to comma se alag karo.
   - **System user access token**
   - **GST on spend**: India billing par "Haan" rakho
5. **Test** dabao (account ka naam dikhega), phir **Sync now**. Pehli baar max 365 din ka data aata hai, uske baad har 3 ghante pichhle 7 din.

> Graph API version field default `v23.0` hai. Meta purana version band kare to yahan naya version likh do.

## Google Ads
Google ka setup thoda lamba hai:
1. **Developer token**: MCC (manager) account → **Tools → API Center**. **Basic access** approve hona chahiye, warna sirf test accounts chalenge. Approval mein 1–3 hafte lag sakte hain.
2. **OAuth client**: Google Cloud Console → APIs & Services → **Google Ads API enable** karo → Credentials → OAuth client (Desktop / Web). Isse Client ID aur Client Secret milenge.
3. **Refresh token**: OAuth Playground mein apna client ID/secret daalo, scope `https://www.googleapis.com/auth/adwords` chuno, aur authorize karke refresh token lo.
4. ProfitLens → **Ads → Google Ads → Connect**. Ye fields daalo:
   - **Customer ID**: `123-456-7890`. Multiple ho to comma se alag karo.
   - **Manager (MCC) ID**: sirf tab, jab account MCC ke under ho
   - Developer token, Client ID, Client Secret, Refresh token
   - **API version**: default `v22`. Google version sunset kare to yahan naya likh do.
5. **Test**, phir **Sync now**.

## Marketing team (commission)
**Marketing Team** page par 1–10 log add kar sakte ho. Har member ke liye ye set hota hai:

| Commission type | Hisaab |
|---|---|
| ₹ per order | ₹X × eligible orders |
| % of net revenue | X% × eligible orders ki net revenue (GST ke bina) |
| % of ad spend | X% × member ke platforms (Meta/Google) ka spend |
| % of contribution profit | X% × eligible orders ka CM2 (shipping ke baad, marketing se pehle) |
| Fixed salary | Monthly salary ÷ mahine ke din, har din ka hissa |

- **Eligible orders** = cancelled aur RTO chhod ke.
- **Kin orders par** commission lagega: sabhi orders, sirf Meta wale, ya sirf Google wale. Meta/Google ka faisla order ke UTM se hota hai.
- **Inactive** member ka cost nahi judta, purane dino ka bhi nahi. Isliye kisi ko hatana ho to delete ki jagah inactive karo, aur yaad rakho ki uska purana cost bhi hat jaayega.

## Marketing cost per order
```
Din ka marketing   = Meta spend + Google spend + commission + salary (din ka hissa)   — GST ke bina
Order ka share     = din ka marketing ÷ us din ke orders (cancelled chhod ke)
CM3                = CM2 − marketing share
```
- Jis din koi order nahi aaya, us din ka kharcha report ke **total mein judta hai**, par kisi order par nahi bat'ta. Report mein ye "unallocated" naam se dikhta hai.
- Har sync ya cost change ke baad ye hisaab apne aap dobara chalta hai.

## Report ke metrics
| Metric | Matlab |
|---|---|
| **MER** | Net revenue ÷ ad spend. Ye Shopify ka sach hai. |
| **Platform ROAS** | Meta/Google ki apni reported purchase value ÷ spend. Ye aksar zyada dikhta hai. |
| **POAS** | CM2 ÷ ad spend, yaani har ₹1 ad par kitna contribution profit aaya |
| **Break-even ROAS** | Net revenue ÷ CM2. MER isse kam ho to ads loss mein chal rahe hain, aur campaign table mein aise campaigns laal dikhte hain. |
| **Cost per Meta / Google order** | Platform spend ÷ us platform ke UTM orders |

## Real data ke saath verify karna hai
- Meta Ads Manager mein campaign-wise spend ko report se milao, same date range aur account timezone par.
- Google Ads UI ka "Cost" report ke saath match hona chahiye. Paise mein 1 paise tak ka rounding farq ho sakta hai.
- Agar UTM channel galat aa raha hai (sab "direct"), to Shopify ke customer journey / UTM tagging check karo.
