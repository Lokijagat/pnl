import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search, ShoppingBag } from "lucide-react";
import { DELIVERY_STATUS_LABELS, PAYMENT_MODE_LABELS, PAYMENT_MODES, type DeliveryStatus, type PaymentMode } from "@pnl/shared";
import { STATUS_TONE as SHIP_TONE } from "./Shipments";
import { Badge, Button, Card, Dialog, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, inr, pct, todayIST } from "@/lib/format";
import { cn } from "@/lib/utils";

interface OrderRow {
  id: string;
  name: string;
  processedAt: string;
  status: string;
  paymentMode: PaymentMode;
  financialStatus?: string;
  fulfillmentStatus?: string;
  totalPrice: number;
  tax: number;
  refunded: number;
  netRevenue: number;
  cogs: number;
  packing: number;
  grossProfit: number;
  shippingCost: number;
  cm2: number;
  marketingCost: number;
  cm3: number;
  deliveryStatus: DeliveryStatus | null;
  courier: string | null;
  isRto: boolean;
  costMissing: boolean;
  state?: string;
  pincode?: string;
  channel?: string;
  items: string;
}
interface Summary {
  orders: number;
  activeOrders: number;
  cancelled: number;
  cod: number;
  prepaid: number;
  partialCod: number;
  grossSales: number;
  tax: number;
  refunded: number;
  netRevenue: number;
  cogs: number;
  packing: number;
  grossProfit: number;
  shippingCost: number;
  cm2: number;
  marketingCost: number;
  cm3: number;
  rto: number;
  shipped: number;
  aov: number;
  costMissing: number;
}

const PRESETS = [
  { label: "Aaj", from: 0, to: 0 },
  { label: "Kal", from: -1, to: -1 },
  { label: "7 din", from: -6, to: 0 },
  { label: "30 din", from: -29, to: 0 },
  { label: "90 din", from: -89, to: 0 },
] as const;

const STATUS_TONE: Record<string, "gray" | "green" | "red" | "amber"> = {
  open: "green",
  cancelled: "red",
  refunded: "red",
  partially_refunded: "amber",
};
const MODE_TONE: Record<PaymentMode, "indigo" | "amber" | "gray"> = { prepaid: "indigo", cod: "amber", partial_cod: "gray" };
const LIMIT = 50;

export function OrdersPage() {
  const [from, setFrom] = useState(todayIST(-29));
  const [to, setTo] = useState(todayIST());
  const [mode, setMode] = useState<PaymentMode | "">("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [from, to, mode, status, debounced]);

  const { data, isLoading } = useQuery({
    queryKey: ["orders", from, to, mode, status, debounced, page],
    queryFn: async () =>
      (
        await api.get<{ total: number; summary: Summary; rows: OrderRow[] }>("/orders", {
          params: { from, to, paymentMode: mode || undefined, status: status || undefined, q: debounced || undefined, page, limit: LIMIT },
        })
      ).data,
    placeholderData: keepPreviousData,
  });
  const s = data?.summary;
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / LIMIT));

  return (
    <div>
      <PageHeader title="Orders" description="Har order ka net revenue (GST ke bina), COGS, packing aur gross profit (CM1). Shipping, fees aur marketing agle phases mein judenge." />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => {
            const f = todayIST(p.from);
            const t = todayIST(p.to);
            return (
              <Button
                key={p.label}
                size="sm"
                variant={from === f && to === t ? "primary" : "outline"}
                onClick={() => {
                  setFrom(f);
                  setTo(t);
                }}
              >
                {p.label}
              </Button>
            );
          })}
          <Input type="date" className="h-8 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground">→</span>
          <Input type="date" className="h-8 w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select className="h-9 w-40" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode | "")}>
            <option value="">All payments</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
          <Select className="h-9 w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All status</option>
            <option value="open">Open</option>
            <option value="cancelled">Cancelled</option>
            <option value="partially_refunded">Partially refunded</option>
            <option value="refunded">Refunded</option>
          </Select>
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-9" placeholder="Order #, SKU, pincode" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Summary */}
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Orders" value={String(s.orders)} sub={`Prepaid ${s.prepaid} · COD ${s.cod}${s.partialCod ? ` · Partial ${s.partialCod}` : ""}`} />
          <Stat label="Net revenue" value={inr(s.netRevenue)} sub={`GST ${inr(s.tax)} · Refund ${inr(s.refunded)}`} />
          <Stat label="AOV" value={inr(s.aov)} sub={`${s.cancelled} cancelled`} />
          <Stat label="COGS" value={inr(s.cogs)} sub={pct(s.cogs, s.netRevenue) + " of revenue"} />
          <Stat label="Packing" value={inr(s.packing)} sub={pct(s.packing, s.netRevenue) + " of revenue"} />
          <Stat
            label="Gross profit (CM1)"
            value={inr(s.grossProfit)}
            sub={pct(s.grossProfit, s.netRevenue) + " margin"}
            tone={s.grossProfit < 0 ? "bad" : "good"}
          />
          <Stat label="Shipping" value={inr(s.shippingCost)} sub={`${s.shipped} shipped · ${s.rto} RTO`} />
          <Stat label="CM2 (after shipping)" value={inr(s.cm2)} sub={pct(s.cm2, s.netRevenue) + " margin"} tone={s.cm2 < 0 ? "bad" : "good"} />
          <Stat label="Marketing" value={inr(s.marketingCost)} sub={(s.activeOrders ? inr(s.marketingCost / s.activeOrders, true) : "—") + " per order"} />
          <Stat label="CM3 (after marketing)" value={inr(s.cm3)} sub={pct(s.cm3, s.netRevenue) + " margin"} tone={s.cm3 < 0 ? "bad" : "good"} />
        </div>
      )}
      {s && s.costMissing > 0 && (
        <p className="mb-4 flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="size-4" /> {s.costMissing} orders mein kisi product ka COGS missing hai — Products & COGS page par daalo.
        </p>
      )}

      <Card>
        {isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ShoppingBag className="size-5" />} title="Is filter mein koi order nahi" description="Date range badlo, ya Integrations se Shopify sync karo." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Net rev.</th>
                  <th className="px-4 py-3 text-right font-medium">COGS</th>
                  <th className="px-4 py-3 text-right font-medium">Packing</th>
                  <th className="px-4 py-3 text-right font-medium">CM1</th>
                  <th className="px-4 py-3 text-right font-medium">Shipping</th>
                  <th className="px-4 py-3 text-right font-medium">CM2</th>
                  <th className="px-4 py-3 text-right font-medium">Mktg</th>
                  <th className="px-4 py-3 text-right font-medium">CM3</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((o) => (
                  <tr key={o.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(o.id)}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{o.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDateTime(o.processedAt)}
                        {o.state ? ` · ${o.state}` : ""}
                        {o.channel && o.channel !== "direct" ? ` · ${o.channel}` : ""}
                      </p>
                      <p className="max-w-xs truncate text-xs text-muted-foreground">{o.items}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={MODE_TONE[o.paymentMode]}>{PAYMENT_MODE_LABELS[o.paymentMode]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[o.status] ?? "gray"}>{o.status.replace("_", " ")}</Badge>
                      {o.deliveryStatus && (
                        <div className="mt-1">
                          <Badge tone={SHIP_TONE[o.deliveryStatus]}>{DELIVERY_STATUS_LABELS[o.deliveryStatus]}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{inr(o.totalPrice, true)}</td>
                    <td className="px-4 py-3 text-right">{inr(o.netRevenue, true)}</td>
                    <td className="px-4 py-3 text-right">
                      {inr(o.cogs, true)}
                      {o.costMissing && <AlertTriangle className="ml-1 inline size-3.5 text-warning" />}
                    </td>
                    <td className="px-4 py-3 text-right">{inr(o.packing, true)}</td>
                    <td className={cn("px-4 py-3 text-right font-medium", o.grossProfit < 0 ? "text-danger" : "text-success")}>
                      {inr(o.grossProfit, true)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {o.shippingCost ? inr(o.shippingCost, true) : <span className="text-muted-foreground">—</span>}
                      {o.courier && <p className="text-xs text-muted-foreground">{o.courier}</p>}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-medium", o.cm2 < 0 ? "text-danger" : "text-success")}>{inr(o.cm2, true)}</td>
                    <td className="px-4 py-3 text-right">{o.marketingCost ? inr(o.marketingCost, true) : <span className="text-muted-foreground">—</span>}</td>
                    <td className={cn("px-4 py-3 text-right font-semibold", o.cm3 < 0 ? "text-danger" : "text-success")}>{inr(o.cm3, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-border p-3 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <span className="text-muted-foreground">
              {page} / {pages}
            </span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>

      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-xl font-semibold", tone === "bad" && "text-danger", tone === "good" && "text-success")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

interface OrderDetailRes {
  name: string;
  processedAt: string;
  paymentMode: PaymentMode;
  gateways: string[];
  status: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  shipping?: { city?: string; state?: string; pincode?: string };
  utm?: { source?: string; medium?: string; campaign?: string; channel?: string };
  customer?: { ordersCount?: number };
  money: Record<string, number>;
  shipments: { id: string; awb?: string; courierName?: string; provider: string; status: DeliveryStatus; isReverse: boolean; zone?: string; chargesSource: string; charges: Record<string, number> }[];
  lineItems: { sku: string; title: string; quantity: number; currentQuantity: number; unitPrice: number; discount: number; tax: number; taxRateBp: number; cogsUnit: number; packingUnit: number; costMissing: boolean }[];
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: o } = useQuery({ queryKey: ["order", id], queryFn: async () => (await api.get<OrderDetailRes>(`/orders/${id}`)).data });
  const m = o?.money ?? {};
  const lines: [string, number | undefined, boolean?][] = [
    ["Gross sales", m.grossSales],
    ["− Discounts", m.discounts],
    ["+ Shipping charged", m.shippingCharged],
    ["Total paid", m.totalPrice, true],
    ["− GST", m.tax],
    ["− Refunded", m.refunded],
    ["Net revenue (ex-GST)", m.netRevenue, true],
    ["− COGS", m.cogs],
    ["− Packing", m.packing],
    ["Gross profit (CM1)", m.grossProfit, true],
    ["− Shipping (ex-GST)", m.shippingCost],
    ["CM2", m.cm2, true],
    ["− Marketing (us din ka share)", m.marketingCost],
    ["CM3", m.cm3, true],
  ];

  return (
    <Dialog open onClose={onClose} title={o ? `Order ${o.name}` : "Order"} wide>
      {!o ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge tone={MODE_TONE[o.paymentMode]}>{PAYMENT_MODE_LABELS[o.paymentMode]}</Badge>
            <Badge tone={STATUS_TONE[o.status] ?? "gray"}>{o.status}</Badge>
            {o.financialStatus && <Badge>{o.financialStatus}</Badge>}
            {o.fulfillmentStatus && <Badge>{o.fulfillmentStatus}</Badge>}
          </div>
          <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
            <p>📅 {fmtDateTime(o.processedAt)}</p>
            <p>💳 {o.gateways.join(", ") || "—"}</p>
            <p>📍 {[o.shipping?.city, o.shipping?.state, o.shipping?.pincode].filter(Boolean).join(", ") || "—"}</p>
            <p>📣 {o.utm?.channel ?? "—"}{o.utm?.campaign ? ` · ${o.utm.campaign}` : ""}</p>
            {o.customer?.ordersCount != null && <p>👤 Customer ke total orders: {o.customer.ordersCount}</p>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">GST</th>
                  <th className="px-3 py-2 text-right">COGS/u</th>
                  <th className="px-3 py-2 text-right">Pack/u</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      {l.title}
                      <div className="font-mono text-muted-foreground">{l.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {l.quantity}
                      {l.currentQuantity !== l.quantity && <span className="text-danger"> ({l.currentQuantity})</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{inr(l.unitPrice, true)}</td>
                    <td className="px-3 py-2 text-right">
                      {inr(l.tax, true)} <span className="text-muted-foreground">({l.taxRateBp / 100}%)</span>
                    </td>
                    <td className="px-3 py-2 text-right">{l.costMissing ? <Badge tone="amber">missing</Badge> : inr(l.cogsUnit, true)}</td>
                    <td className="px-3 py-2 text-right">{inr(l.packingUnit, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-border">
            {lines.map(([label, val, bold]) => (
              <div key={label} className={cn("flex justify-between px-4 py-2", bold && "border-t border-border bg-muted/50 font-semibold")}>
                <span>{label}</span>
                <span className={cn(bold && (val ?? 0) < 0 && "text-danger")}>{inr(val ?? 0, true)}</span>
              </div>
            ))}
          </div>
          {o.shipments.length > 0 && (
            <div className="rounded-lg border border-border">
              <p className="border-b border-border px-4 py-2 font-medium">Shipments</p>
              {o.shipments.map((sh) => (
                <div key={sh.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs">
                  <span className="font-mono">{sh.awb ?? "—"}</span>
                  <span>{sh.courierName ?? sh.provider}{sh.isReverse ? " · reverse" : ""}</span>
                  <Badge tone={SHIP_TONE[sh.status]}>{DELIVERY_STATUS_LABELS[sh.status]}</Badge>
                  <span className="text-muted-foreground">
                    Freight {inr(sh.charges.freight, true)} · COD {inr(sh.charges.cod, true)} · RTO {inr(sh.charges.rto, true)}
                    {sh.charges.weightDiscrepancy ? ` · Wt ${inr(sh.charges.weightDiscrepancy, true)}` : ""}
                  </span>
                  <span className="ml-auto font-medium">{inr(sh.charges.total, true)} <span className="text-muted-foreground">({sh.chargesSource})</span></span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Marketing share = us din ka (ads + commission + salary) ÷ us din ke orders. Gateway fee Phase 5 mein judegi. RTO order: COGS 0 (stock wapas), COD RTO revenue 0.</p>
        </div>
      )}
    </Dialog>
  );
}
