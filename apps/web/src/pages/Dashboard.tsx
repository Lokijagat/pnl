import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, IndianRupee, Megaphone, Package, Percent, ShoppingBag, Truck, Undo2, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/hooks/useAuth";
import type { IntegrationRow } from "./Integrations";

/** Phase 1: KPI tiles ka layout. Data Phase 2–5 mein daily_summary se aayega. */
const KPIS: { label: string; icon: ReactNode; hint: string }[] = [
  { label: "Net Revenue", icon: <IndianRupee className="size-4" />, hint: "GST, discount, refund ke baad" },
  { label: "Orders", icon: <ShoppingBag className="size-4" />, hint: "Prepaid + COD" },
  { label: "Net Profit", icon: <Wallet className="size-4" />, hint: "Sab costs ke baad" },
  { label: "Profit %", icon: <Percent className="size-4" />, hint: "Net profit ÷ net revenue" },
  { label: "Marketing / order", icon: <Megaphone className="size-4" />, hint: "(Ads + commission) ÷ orders" },
  { label: "Delivery / order", icon: <Truck className="size-4" />, hint: "Forward + COD + RTO ÷ orders" },
  { label: "COGS + Packing", icon: <Package className="size-4" />, hint: "Product + packing cost" },
  { label: "RTO %", icon: <Undo2 className="size-4" />, hint: "RTO ÷ shipped" },
];

export function DashboardPage() {
  const { data: session } = useSession();
  const { data: integrations = [] } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await api.get<IntegrationRow[]>("/integrations")).data,
  });
  const has = (cat: string) => integrations.some((i) => i.category === cat);
  const { data: members = [] } = useQuery({
    queryKey: ["marketing-members"],
    queryFn: async () => (await api.get<unknown[]>("/marketing/members")).data,
  });

  const steps = [
    { done: has("store"), label: "Shopify store connect karo", to: "/integrations" },
    { done: has("ads"), label: "Meta / Google Ads connect karo", to: "/integrations" },
    { done: has("shipping"), label: "Courier (Shiprocket / Delhivery…) connect karo", to: "/integrations" },
    { done: has("payment"), label: "Payment gateway add karo", to: "/integrations" },
    { done: members.length > 0, label: "Marketing team + commission set karo", to: "/marketing-team" },
    { done: false, label: "Products ka COGS & packing cost daalo", to: "/products" },
    { done: false, label: "Fixed expenses (rent, salary, tools…) daalo", to: "/expenses" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div>
      <PageHeader title={`Namaste, ${session?.user.name.split(" ")[0] ?? ""} 👋`} description={`${session?.tenant.name} — profit overview`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {KPIS.map((k) => (
          <Card key={k.label} className="p-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wide">{k.label}</span>
              {k.icon}
            </div>
            <p className="mt-3 text-2xl font-semibold text-muted-foreground/50">—</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h3 className="font-semibold">Setup checklist</h3>
            <p className="text-sm text-muted-foreground">Sab connect hote hi P&L automatically calculate hoga</p>
          </div>
          <span className="text-sm font-medium text-primary">
            {doneCount}/{steps.length}
          </span>
        </div>
        <ul className="divide-y divide-border">
          {steps.map((s) => (
            <li key={s.label}>
              <Link to={s.to} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/60">
                {s.done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground/50" />}
                <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                <ArrowRight className="ml-auto size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
