import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Truck } from "lucide-react";
import { PAYMENT_MODE_LABELS, type PaymentMode } from "@pnl/shared";
import { Button, Card, CardHeader, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, todayIST } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Metrics {
  shipments: number;
  prepaid: number;
  cod: number;
  delivered: number;
  rto: number;
  inTransit: number;
  cancelled: number;
  reverseCount: number;
  rtoPct: number;
  freight: number;
  freightPrepaid: number;
  freightCod: number;
  codCharges: number;
  rtoCharges: number;
  reverseCharges: number;
  weightDiscrepancy: number;
  other: number;
  gst: number;
  total: number;
  prepaidCost: number;
  codCost: number;
  perOrder: number;
  prepaidPerOrder: number;
  codPerOrder: number;
  codChargePerCodOrder: number;
  rtoCostPerRto: number;
  noCharges: number;
  estimated: number;
  invoiced: number;
}
interface ReportRes {
  totals: Metrics;
  periods: (Metrics & { period: string })[];
  byCourier: (Metrics & { key: string })[];
  byState: (Metrics & { key: string })[];
  byZone: (Metrics & { key: string })[];
  rtoPincodes: { pincode: string; state?: string; city?: string; shipments: number; rto: number; delivered: number; rtoPct: number; rtoCharges: number }[];
  options: { couriers: string[]; states: string[]; zones: string[] };
  unmatchedShipments: number;
}

type GroupBy = "day" | "week" | "month";

function monthRange(offset: number) {
  const [y, m] = todayIST().split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const f = (x: Date) => x.toISOString().slice(0, 10);
  return { from: f(d), to: offset === 0 ? todayIST() : f(last) };
}

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "7 din", range: () => ({ from: todayIST(-6), to: todayIST() }) },
  { label: "30 din", range: () => ({ from: todayIST(-29), to: todayIST() }) },
  { label: "90 din", range: () => ({ from: todayIST(-89), to: todayIST() }) },
  { label: "Is mahine", range: () => monthRange(0) },
  { label: "Pichhla mahina", range: () => monthRange(-1) },
];

const pct1 = (n: number) => `${n.toFixed(1)}%`;

function fmtPeriod(p: string, g: GroupBy) {
  const d = new Date(p + "T00:00:00+05:30");
  if (g === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  if (g === "week") {
    const end = new Date(+d + 6 * 86_400_000);
    const o = { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" } as const;
    return `${d.toLocaleDateString("en-IN", o)} – ${end.toLocaleDateString("en-IN", o)}`;
  }
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

export function DeliveryReportPage() {
  const [range, setRange] = useState(PRESETS[1]!.range());
  const [groupBy, setGroupBy] = useState<GroupBy>("week");
  const [dateBasis, setDateBasis] = useState<"ship" | "order">("ship");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">("");
  const [statusGroup, setStatusGroup] = useState("");
  const [courier, setCourier] = useState("");
  const [state, setState] = useState("");
  const [zone, setZone] = useState("");

  const params = {
    ...range,
    groupBy,
    dateBasis,
    paymentMode: paymentMode || undefined,
    statusGroup: statusGroup || undefined,
    courier: courier || undefined,
    state: state || undefined,
    zone: zone || undefined,
  };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["delivery-report", params],
    queryFn: async () => (await api.get<ReportRes>("/reports/delivery", { params })).data,
    placeholderData: keepPreviousData,
  });
  const t = data?.totals;

  const exportCsv = () => {
    if (!data) return;
    const cols: [string, (m: Metrics & { period: string }) => string | number][] = [
      ["Period", (m) => m.period],
      ["Shipments", (m) => m.shipments],
      ["Prepaid orders", (m) => m.prepaid],
      ["COD orders", (m) => m.cod],
      ["Total cost (ex-GST)", (m) => m.total],
      ["GST", (m) => m.gst],
      ["Cost per order", (m) => m.perOrder],
      ["Prepaid dispatch cost", (m) => m.prepaidCost],
      ["Prepaid per order", (m) => m.prepaidPerOrder],
      ["COD dispatch cost", (m) => m.codCost],
      ["COD per order", (m) => m.codPerOrder],
      ["COD charges", (m) => m.codCharges],
      ["Delivered", (m) => m.delivered],
      ["RTO", (m) => m.rto],
      ["RTO %", (m) => m.rtoPct.toFixed(1)],
      ["RTO charges", (m) => m.rtoCharges],
      ["Reverse charges", (m) => m.reverseCharges],
      ["Weight discrepancy", (m) => m.weightDiscrepancy],
    ];
    const lines = [cols.map((c) => c[0]).join(","), ...data.periods.map((p) => cols.map((c) => c[1](p)).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `delivery-cost-${range.from}-to-${range.to}-${groupBy}.csv`;
    a.click();
  };

  return (
    <div>
      <PageHeader
        title="Delivery Cost Report"
        description="Week/month wise per-order delivery cost — prepaid vs COD dispatch, COD charges, RTO charges. Amounts GST ke bina (GST alag — ITC)."
        action={
          <div className="flex gap-2">
            <Link to="/shipments">
              <Button variant="outline">Shipments</Button>
            </Link>
            <Button variant="outline" onClick={exportCsv} disabled={!data?.periods.length}>
              <Download className="size-4" /> CSV
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => {
            const r = p.range();
            const active = r.from === range.from && r.to === range.to;
            return (
              <Button key={p.label} size="sm" variant={active ? "primary" : "outline"} onClick={() => setRange(r)}>
                {p.label}
              </Button>
            );
          })}
          <Input type="date" className="h-8 w-auto" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span className="text-muted-foreground">→</span>
          <Input type="date" className="h-8 w-auto" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <div className="ml-auto flex rounded-lg border border-border p-0.5">
            {(["day", "week", "month"] as GroupBy[]).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={cn("rounded-md px-3 py-1 text-sm", groupBy === g ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted")}
              >
                {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Select className="h-9" value={dateBasis} onChange={(e) => setDateBasis(e.target.value as "ship" | "order")}>
            <option value="ship">Date: Ship date</option>
            <option value="order">Date: Order date</option>
          </Select>
          <Select className="h-9" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode | "")}>
            <option value="">All payments</option>
            <option value="prepaid">{PAYMENT_MODE_LABELS.prepaid}</option>
            <option value="cod">COD (+ partial)</option>
          </Select>
          <Select className="h-9" value={statusGroup} onChange={(e) => setStatusGroup(e.target.value)}>
            <option value="">All status</option>
            <option value="delivered">Delivered</option>
            <option value="rto">RTO</option>
            <option value="in_transit">In transit / NDR</option>
            <option value="cancelled">Cancelled / Lost</option>
          </Select>
          <Select className="h-9" value={courier} onChange={(e) => setCourier(e.target.value)}>
            <option value="">All couriers</option>
            {data?.options.couriers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select className="h-9" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            {data?.options.states.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select className="h-9" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">All zones</option>
            {data?.options.zones.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
      </Card>

      {/* Data quality */}
      {t && (t.noCharges > 0 || (data?.unmatchedShipments ?? 0) > 0 || t.estimated > 0) && (
        <div className="mb-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.noCharges > 0 && (
            <p className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" /> {t.noCharges} shipments ke charges abhi nahi aaye (courier sync / invoice CSV se aayenge).
            </p>
          )}
          {t.estimated > 0 && <p>≈ {t.estimated} shipments ke charges rate-API estimate hain — actual ke liye invoice CSV upload karo.</p>}
          {(data?.unmatchedShipments ?? 0) > 0 && (
            <p>
              {data?.unmatchedShipments} shipments kisi Shopify order se match nahi hue —{" "}
              <Link to="/shipments?unmatched=1" className="font-medium underline">
                dekho
              </Link>
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !t || (t.shipments === 0 && t.total === 0 && t.cancelled === 0) ? (
        <Card>
          <EmptyState
            icon={<Truck className="size-5" />}
            title="Is range mein koi shipment nahi"
            description="Integrations par Shiprocket / Delhivery connect karke Sync karo, ya Shipments page se courier CSV import karo."
          />
        </Card>
      ) : (
        <div className={cn("space-y-6 transition-opacity", isFetching && "opacity-60")}>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Total delivery cost" value={inr(t.total)} sub={`+ GST ${inr(t.gst)} · ${t.shipments} shipments`} />
            <Kpi label="Cost / order" value={inr(t.perOrder, true)} sub="Total ÷ shipped orders" emphasis />
            <Kpi label="Prepaid dispatch / order" value={inr(t.prepaidPerOrder, true)} sub={`${t.prepaid} orders · ${inr(t.prepaidCost)}`} />
            <Kpi label="COD dispatch / order" value={inr(t.codPerOrder, true)} sub={`${t.cod} orders · ${inr(t.codCost)}`} />
            <Kpi label="COD charges" value={inr(t.codCharges)} sub={`${inr(t.codChargePerCodOrder, true)} per COD order`} />
            <Kpi label="RTO charges" value={inr(t.rtoCharges)} sub={`${t.rto} RTO · ${pct1(t.rtoPct)} · ${inr(t.rtoCostPerRto, true)}/RTO`} tone={t.rtoPct > 20 ? "bad" : undefined} />
            <Kpi label="Forward freight" value={inr(t.freight)} sub={`Prepaid ${inr(t.freightPrepaid)} · COD ${inr(t.freightCod)}`} />
            <Kpi label="Weight discrepancy + reverse" value={inr(t.weightDiscrepancy + t.reverseCharges + t.other)} sub={`Weight ${inr(t.weightDiscrepancy)} · Reverse ${inr(t.reverseCharges)}`} />
          </div>

          {/* Period table */}
          <Card>
            <CardHeader
              title={`${groupBy === "day" ? "Daily" : groupBy === "week" ? "Weekly" : "Monthly"} delivery cost`}
              description="Per order = us period ke total charges ÷ shipped orders"
            />
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="border-b border-border text-right text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Period</th>
                    <th className="px-3 py-3 font-medium">Orders</th>
                    <th className="px-3 py-3 font-medium">Total cost</th>
                    <th className="bg-primary/5 px-3 py-3 font-medium">Per order</th>
                    <th className="px-3 py-3 font-medium">Prepaid (n)</th>
                    <th className="px-3 py-3 font-medium">Prepaid / order</th>
                    <th className="px-3 py-3 font-medium">COD (n)</th>
                    <th className="px-3 py-3 font-medium">COD / order</th>
                    <th className="px-3 py-3 font-medium">COD charges</th>
                    <th className="px-3 py-3 font-medium">RTO (%)</th>
                    <th className="px-3 py-3 font-medium">RTO charges</th>
                    <th className="px-3 py-3 font-medium">Weight disc.</th>
                    <th className="px-4 py-3 font-medium">GST</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-right">
                  {data!.periods.map((p) => (
                    <PeriodRow key={p.period} label={fmtPeriod(p.period, groupBy)} m={p} />
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/50 font-semibold">
                  <PeriodRow label="Total" m={t} />
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Courier comparison */}
          <Card>
            <CardHeader title="Courier comparison" description="Kaunsa courier sasta hai aur kiska RTO kam hai" />
            <BreakdownTable rows={data!.byCourier} keyLabel="Courier" />
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Zone-wise" />
              <BreakdownTable rows={data!.byZone} keyLabel="Zone" compact />
            </Card>
            <Card>
              <CardHeader title="State-wise" description="Top 40" />
              <BreakdownTable rows={data!.byState} keyLabel="State" compact />
            </Card>
          </div>

          <Card>
            <CardHeader title="High-RTO pincodes" description="Kam se kam 2 RTO — inpar COD band karne ka socho" />
            {data!.rtoPincodes.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Koi pincode nahi 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-right text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Pincode</th>
                      <th className="px-3 py-3 text-left font-medium">City / State</th>
                      <th className="px-3 py-3 font-medium">Shipments</th>
                      <th className="px-3 py-3 font-medium">Delivered</th>
                      <th className="px-3 py-3 font-medium">RTO</th>
                      <th className="px-3 py-3 font-medium">RTO %</th>
                      <th className="px-4 py-3 font-medium">RTO charges</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-right">
                    {data!.rtoPincodes.map((p) => (
                      <tr key={p.pincode}>
                        <td className="px-4 py-2.5 text-left font-mono">{p.pincode}</td>
                        <td className="px-3 py-2.5 text-left text-muted-foreground">{[p.city, p.state].filter(Boolean).join(", ")}</td>
                        <td className="px-3 py-2.5">{p.shipments}</td>
                        <td className="px-3 py-2.5">{p.delivered}</td>
                        <td className="px-3 py-2.5 font-medium text-danger">{p.rto}</td>
                        <td className="px-3 py-2.5">{pct1(p.rtoPct)}</td>
                        <td className="px-4 py-2.5">{inr(p.rtoCharges)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone, emphasis }: { label: string; value: string; sub?: ReactNode; tone?: "bad"; emphasis?: boolean }) {
  return (
    <Card className={cn("p-4", emphasis && "border-primary/40 bg-primary/5")}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-xl font-semibold", tone === "bad" && "text-danger")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function PeriodRow({ label, m }: { label: string; m: Metrics }) {
  return (
    <tr className="hover:bg-muted/40">
      <td className="px-4 py-2.5 text-left font-medium">{label}</td>
      <td className="px-3 py-2.5">{m.shipments}</td>
      <td className="px-3 py-2.5">{inr(m.total)}</td>
      <td className="bg-primary/5 px-3 py-2.5 font-semibold">{inr(m.perOrder, true)}</td>
      <td className="px-3 py-2.5">
        {inr(m.prepaidCost)} <span className="text-xs text-muted-foreground">({m.prepaid})</span>
      </td>
      <td className="px-3 py-2.5">{inr(m.prepaidPerOrder, true)}</td>
      <td className="px-3 py-2.5">
        {inr(m.codCost)} <span className="text-xs text-muted-foreground">({m.cod})</span>
      </td>
      <td className="px-3 py-2.5">{inr(m.codPerOrder, true)}</td>
      <td className="px-3 py-2.5">{inr(m.codCharges)}</td>
      <td className={cn("px-3 py-2.5", m.rtoPct > 20 && "text-danger")}>
        {m.rto} <span className="text-xs text-muted-foreground">({pct1(m.rtoPct)})</span>
      </td>
      <td className="px-3 py-2.5">{inr(m.rtoCharges)}</td>
      <td className="px-3 py-2.5">{inr(m.weightDiscrepancy)}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{inr(m.gst)}</td>
    </tr>
  );
}

function BreakdownTable({ rows, keyLabel, compact }: { rows: (Metrics & { key: string })[]; keyLabel: string; compact?: boolean }) {
  const sorted = useMemo(() => rows, [rows]);
  if (!sorted.length) return <p className="p-5 text-sm text-muted-foreground">Data nahi</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-sm">
        <thead className="border-b border-border text-right text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">{keyLabel}</th>
            <th className="px-3 py-3 font-medium">Orders</th>
            <th className="px-3 py-3 font-medium">RTO %</th>
            <th className="px-3 py-3 font-medium">Per order</th>
            {!compact && (
              <>
                <th className="px-3 py-3 font-medium">Prepaid / order</th>
                <th className="px-3 py-3 font-medium">COD / order</th>
                <th className="px-3 py-3 font-medium">COD charges</th>
                <th className="px-3 py-3 font-medium">RTO charges</th>
              </>
            )}
            <th className="px-4 py-3 font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-right">
          {sorted.map((r) => (
            <tr key={r.key} className="hover:bg-muted/40">
              <td className="px-4 py-2.5 text-left font-medium">{r.key}</td>
              <td className="px-3 py-2.5">{r.shipments}</td>
              <td className={cn("px-3 py-2.5", r.rtoPct > 20 && "text-danger")}>{pct1(r.rtoPct)}</td>
              <td className="px-3 py-2.5 font-semibold">{inr(r.perOrder, true)}</td>
              {!compact && (
                <>
                  <td className="px-3 py-2.5">{inr(r.prepaidPerOrder, true)}</td>
                  <td className="px-3 py-2.5">{inr(r.codPerOrder, true)}</td>
                  <td className="px-3 py-2.5">{inr(r.codCharges)}</td>
                  <td className="px-3 py-2.5">{inr(r.rtoCharges)}</td>
                </>
              )}
              <td className="px-4 py-2.5">{inr(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
