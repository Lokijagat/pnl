import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Megaphone } from "lucide-react";
import { COMMISSION_TYPE_LABELS, type CommissionType } from "@pnl/shared";
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { inr, todayIST } from "@/lib/format";
import { cn } from "@/lib/utils";

interface M {
  metaSpend: number;
  googleSpend: number;
  adSpend: number;
  adGst: number;
  commission: number;
  fixed: number;
  team: number;
  total: number;
  orders: number;
  netRevenue: number;
  cm2: number;
  cm3: number;
  marketingPerOrder: number;
  adSpendPerOrder: number;
  mer: number;
  platformRoas: number;
  poas: number;
  breakEvenRoas: number | null;
  marketingPctOfRevenue: number;
  purchases: number;
  purchaseValue: number;
  metaOrders: number;
  googleOrders: number;
  costPerMetaOrder: number;
  costPerGoogleOrder: number;
  unallocated: number;
}
interface Res {
  totals: M;
  periods: (M & { period: string })[];
  campaigns: { platform: "meta" | "google"; campaignId: string; name: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; purchases: number; purchaseValue: number; roas: number; costPerPurchase: number }[];
  members: { id: string; name: string; active: boolean; platforms: string[]; commissionType: CommissionType; commissionValue: number; orderScope: string; commission: number; fixed: number; payout: number }[];
  channels: { channel: string; orders: number; netRevenue: number; aov: number; cm2: number }[];
}

type G = "day" | "week" | "month";

function monthRange(offset: number) {
  const [y, m] = todayIST().split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  const f = (x: Date) => x.toISOString().slice(0, 10);
  return { from: f(d), to: offset === 0 ? todayIST() : f(last) };
}
const PRESETS = [
  { label: "7 din", range: () => ({ from: todayIST(-6), to: todayIST() }) },
  { label: "30 din", range: () => ({ from: todayIST(-29), to: todayIST() }) },
  { label: "90 din", range: () => ({ from: todayIST(-89), to: todayIST() }) },
  { label: "Is mahine", range: () => monthRange(0) },
  { label: "Pichhla mahina", range: () => monthRange(-1) },
];

function fmtPeriod(p: string, g: G) {
  const d = new Date(p + "T00:00:00+05:30");
  const o = { timeZone: "Asia/Kolkata" } as const;
  if (g === "month") return d.toLocaleDateString("en-IN", { ...o, month: "short", year: "numeric" });
  if (g === "week") {
    const e = new Date(+d + 6 * 86_400_000);
    return `${d.toLocaleDateString("en-IN", { ...o, day: "2-digit", month: "short" })} – ${e.toLocaleDateString("en-IN", { ...o, day: "2-digit", month: "short" })}`;
  }
  return d.toLocaleDateString("en-IN", { ...o, day: "2-digit", month: "short" });
}
const x = (n: number | null | undefined) => (n == null || n === 0 ? "—" : `${n.toFixed(2)}×`);

export function MarketingReportPage() {
  const [range, setRange] = useState(PRESETS[1]!.range());
  const [groupBy, setGroupBy] = useState<G>("week");
  const [platform, setPlatform] = useState<"" | "meta" | "google">("");

  const params = { ...range, groupBy };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["marketing-report", params],
    queryFn: async () => (await api.get<Res>("/reports/marketing", { params })).data,
    placeholderData: keepPreviousData,
  });
  const t = data?.totals;
  const campaigns = useMemo(() => (data?.campaigns ?? []).filter((c) => !platform || c.platform === platform), [data, platform]);

  const exportCsv = () => {
    if (!data) return;
    const cols: [string, (m: M & { period: string }) => string | number][] = [
      ["Period", (m) => m.period],
      ["Orders", (m) => m.orders],
      ["Net revenue", (m) => m.netRevenue],
      ["Meta spend", (m) => m.metaSpend],
      ["Google spend", (m) => m.googleSpend],
      ["Commission", (m) => m.commission],
      ["Team salary", (m) => m.fixed],
      ["Total marketing", (m) => m.total],
      ["Marketing per order", (m) => m.marketingPerOrder],
      ["MER", (m) => m.mer],
      ["POAS", (m) => m.poas],
      ["CM2", (m) => m.cm2],
      ["CM3", (m) => m.cm3],
    ];
    const lines = [cols.map((c) => c[0]).join(","), ...data.periods.map((p) => cols.map((c) => c[1](p)).join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `marketing-${range.from}-to-${range.to}-${groupBy}.csv`;
    a.click();
  };

  const empty = t && t.total === 0 && t.orders === 0;

  return (
    <div>
      <PageHeader
        title="Marketing Report"
        description="Meta + Google ad spend, marketing team ka commission + salary, aur har order par marketing cost. Amounts GST ke bina."
        action={
          <Button variant="outline" onClick={exportCsv} disabled={!data?.periods.length}>
            <Download className="size-4" /> CSV
          </Button>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-4">
        {PRESETS.map((p) => {
          const r = p.range();
          return (
            <Button key={p.label} size="sm" variant={r.from === range.from && r.to === range.to ? "primary" : "outline"} onClick={() => setRange(r)}>
              {p.label}
            </Button>
          );
        })}
        <Input type="date" className="h-8 w-auto" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-muted-foreground">→</span>
        <Input type="date" className="h-8 w-auto" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <div className="ml-auto flex rounded-lg border border-border p-0.5">
          {(["day", "week", "month"] as G[]).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)} className={cn("rounded-md px-3 py-1 text-sm", groupBy === g ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted")}>
              {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </Card>

      {t && t.unallocated > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0" /> {inr(t.unallocated)} marketing cost aise dino ka hai jin par koi order nahi tha — total mein hai, par kisi order par nahi bata.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !t || empty ? (
        <Card>
          <EmptyState
            icon={<Megaphone className="size-5" />}
            title="Is range mein marketing data nahi"
            description="Integrations par Meta / Google Ads connect karke Sync karo, aur Marketing Team mein members add karo."
          />
        </Card>
      ) : (
        <div className={cn("space-y-6 transition-opacity", isFetching && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Total marketing" value={inr(t.total)} sub={`${t.marketingPctOfRevenue}% of revenue`} />
            <Kpi label="Marketing / order" value={inr(t.marketingPerOrder, true)} sub={`${t.orders} orders · ads ${inr(t.adSpendPerOrder, true)}/order`} emphasis />
            <Kpi label="Ad spend" value={inr(t.adSpend)} sub={`Meta ${inr(t.metaSpend)} · Google ${inr(t.googleSpend)} · GST ${inr(t.adGst)}`} />
            <Kpi label="Team cost" value={inr(t.team)} sub={`Commission ${inr(t.commission)} · Salary ${inr(t.fixed)}`} />
            <Kpi label="MER" value={x(t.mer)} sub="Net revenue ÷ ad spend" />
            <Kpi label="Platform ROAS" value={x(t.platformRoas)} sub={`${t.purchases} purchases (platform-reported)`} />
            <Kpi
              label="POAS / Break-even ROAS"
              value={`${x(t.poas)} / ${x(t.breakEvenRoas)}`}
              sub={t.breakEvenRoas != null && t.mer < t.breakEvenRoas ? "⚠ MER break-even se kam — loss" : "CM2 ÷ ad spend · revenue ÷ CM2"}
              tone={t.breakEvenRoas != null && t.mer < t.breakEvenRoas ? "bad" : undefined}
            />
            <Kpi label="CM3 (after marketing)" value={inr(t.cm3)} sub={`CM2 ${inr(t.cm2)}`} tone={t.cm3 < 0 ? "bad" : "good"} />
          </div>

          <Card>
            <CardHeader title={`${groupBy === "day" ? "Daily" : groupBy === "week" ? "Weekly" : "Monthly"} marketing cost`} description="Marketing / order = (ads + commission + salary) ÷ orders" />
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="border-b border-border text-right text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Period</th>
                    <th className="px-3 py-3 font-medium">Orders</th>
                    <th className="px-3 py-3 font-medium">Net revenue</th>
                    <th className="px-3 py-3 font-medium">Meta</th>
                    <th className="px-3 py-3 font-medium">Google</th>
                    <th className="px-3 py-3 font-medium">Commission</th>
                    <th className="px-3 py-3 font-medium">Salary</th>
                    <th className="px-3 py-3 font-medium">Total</th>
                    <th className="bg-primary/5 px-3 py-3 font-medium">Per order</th>
                    <th className="px-3 py-3 font-medium">MER</th>
                    <th className="px-4 py-3 font-medium">CM3</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-right">
                  {data!.periods.map((p) => (
                    <Row key={p.period} label={fmtPeriod(p.period, groupBy)} m={p} />
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted/50 font-semibold">
                  <Row label="Total" m={t} />
                </tfoot>
              </table>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Marketing team payout"
                description="Is range ka commission + salary"
                action={
                  <Link to="/marketing-team" className="text-sm text-primary hover:underline">
                    Rules →
                  </Link>
                }
              />
              {data!.members.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">Koi member nahi</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-right text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Member</th>
                      <th className="px-3 py-3 font-medium">Commission</th>
                      <th className="px-3 py-3 font-medium">Salary</th>
                      <th className="px-4 py-3 font-medium">Payout</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-right">
                    {data!.members.map((m) => (
                      <tr key={m.id}>
                        <td className="px-4 py-2.5 text-left">
                          <p className="font-medium">
                            {m.name} {!m.active && <Badge>inactive</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {m.commissionType === "per_order" ? `₹${m.commissionValue}/order` : m.commissionType === "none" ? COMMISSION_TYPE_LABELS.none : `${m.commissionValue}% · ${COMMISSION_TYPE_LABELS[m.commissionType]}`}
                            {m.orderScope !== "all" ? ` · ${m.orderScope} orders` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">{inr(m.commission)}</td>
                        <td className="px-3 py-2.5">{inr(m.fixed)}</td>
                        <td className="px-4 py-2.5 font-semibold">{inr(m.payout)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card>
              <CardHeader title="Orders by channel (UTM)" description="Shopify customer journey se — Meta / Google / other / direct" />
              <table className="w-full text-sm">
                <thead className="border-b border-border text-right text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Channel</th>
                    <th className="px-3 py-3 font-medium">Orders</th>
                    <th className="px-3 py-3 font-medium">Net revenue</th>
                    <th className="px-3 py-3 font-medium">AOV</th>
                    <th className="px-4 py-3 font-medium">Ad cost / order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-right">
                  {data!.channels.map((c) => (
                    <tr key={c.channel}>
                      <td className="px-4 py-2.5 text-left font-medium capitalize">{c.channel}</td>
                      <td className="px-3 py-2.5">{c.orders}</td>
                      <td className="px-3 py-2.5">{inr(c.netRevenue)}</td>
                      <td className="px-3 py-2.5">{inr(c.aov, true)}</td>
                      <td className="px-4 py-2.5">
                        {c.channel === "meta" ? inr(t.costPerMetaOrder, true) : c.channel === "google" ? inr(t.costPerGoogleOrder, true) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Campaigns"
              description="Platform-reported purchases / ROAS (attribution platform ka hai, Shopify ka nahi)"
              action={
                <Select className="h-8 w-36" value={platform} onChange={(e) => setPlatform(e.target.value as "" | "meta" | "google")}>
                  <option value="">All platforms</option>
                  <option value="meta">Meta</option>
                  <option value="google">Google</option>
                </Select>
              }
            />
            {campaigns.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Koi campaign nahi</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-sm">
                  <thead className="border-b border-border text-right text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Campaign</th>
                      <th className="px-3 py-3 font-medium">Spend</th>
                      <th className="px-3 py-3 font-medium">Impr.</th>
                      <th className="px-3 py-3 font-medium">Clicks</th>
                      <th className="px-3 py-3 font-medium">CTR</th>
                      <th className="px-3 py-3 font-medium">CPC</th>
                      <th className="px-3 py-3 font-medium">Purchases</th>
                      <th className="px-3 py-3 font-medium">Cost / purchase</th>
                      <th className="px-4 py-3 font-medium">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-right">
                    {campaigns.map((c) => (
                      <tr key={c.platform + c.campaignId} className="hover:bg-muted/40">
                        <td className="max-w-sm px-4 py-2.5 text-left">
                          <Badge tone={c.platform === "meta" ? "indigo" : "amber"}>{c.platform === "meta" ? "Meta" : "Google"}</Badge>{" "}
                          <span className="font-medium">{c.name}</span>
                        </td>
                        <td className="px-3 py-2.5 font-medium">{inr(c.spend)}</td>
                        <td className="px-3 py-2.5">{c.impressions.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2.5">{c.clicks.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2.5">{c.ctr}%</td>
                        <td className="px-3 py-2.5">{inr(c.cpc, true)}</td>
                        <td className="px-3 py-2.5">{c.purchases}</td>
                        <td className="px-3 py-2.5">{c.purchases ? inr(c.costPerPurchase, true) : "—"}</td>
                        <td className={cn("px-4 py-2.5 font-medium", t.breakEvenRoas != null && c.roas > 0 && c.roas < t.breakEvenRoas && "text-danger")}>{x(c.roas)}</td>
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

function Kpi({ label, value, sub, tone, emphasis }: { label: string; value: string; sub?: ReactNode; tone?: "bad" | "good"; emphasis?: boolean }) {
  return (
    <Card className={cn("p-4", emphasis && "border-primary/40 bg-primary/5")}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-xl font-semibold", tone === "bad" && "text-danger", tone === "good" && "text-success")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function Row({ label, m }: { label: string; m: M }) {
  return (
    <tr className="hover:bg-muted/40">
      <td className="px-4 py-2.5 text-left font-medium">{label}</td>
      <td className="px-3 py-2.5">{m.orders}</td>
      <td className="px-3 py-2.5">{inr(m.netRevenue)}</td>
      <td className="px-3 py-2.5">{inr(m.metaSpend)}</td>
      <td className="px-3 py-2.5">{inr(m.googleSpend)}</td>
      <td className="px-3 py-2.5">{inr(m.commission)}</td>
      <td className="px-3 py-2.5">{inr(m.fixed)}</td>
      <td className="px-3 py-2.5">{inr(m.total)}</td>
      <td className="bg-primary/5 px-3 py-2.5 font-semibold">{inr(m.marketingPerOrder, true)}</td>
      <td className="px-3 py-2.5">{x(m.mer)}</td>
      <td className={cn("px-4 py-2.5", m.cm3 < 0 ? "text-danger" : "text-success")}>{inr(m.cm3)}</td>
    </tr>
  );
}
