import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, CreditCard, Megaphone, Pencil, Plug, PlugZap, Plus, RefreshCw, Store, Trash2, Truck, Webhook } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { CATEGORY_LABELS, PROVIDERS, getProvider, type IntegrationCategory, type ProviderDef } from "@pnl/shared";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export interface IntegrationRow {
  id: string;
  provider: string;
  providerName: string;
  category: IntegrationCategory;
  label: string;
  config: Record<string, string>;
  maskedSecrets: Record<string, string>;
  status: "pending" | "connected" | "error" | "disabled";
  lastError: string | null;
  lastSyncAt: string | null;
  webhookUrl: string | null;
  meta: {
    shopName?: string;
    plan?: string;
    scopes?: string[];
    webhooksRegisteredAt?: string;
    webhookTopics?: string[];
    ordersSyncedUntil?: string;
    productsSyncedAt?: string;
  };
}

const CAT_ICON: Record<IntegrationCategory, typeof Store> = {
  store: Store,
  ads: Megaphone,
  shipping: Truck,
  payment: CreditCard,
};
const CATS = Object.keys(CATEGORY_LABELS) as IntegrationCategory[];

const STATUS_TONE = { pending: "amber", connected: "green", error: "red", disabled: "gray" } as const;
const STATUS_LABEL = { pending: "Saved – test pending", connected: "Connected", error: "Error", disabled: "Disabled" };

export function IntegrationsPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canManage = session?.user.role === "owner" || session?.user.role === "admin";
  const [tab, setTab] = useState<IntegrationCategory>("store");
  const [editing, setEditing] = useState<{ def: ProviderDef; row?: IntegrationRow } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await api.get<IntegrationRow[]>("/integrations")).data,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/integrations/${id}`),
    onSuccess: () => {
      toast.success("Integration hata diya");
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const connected = rows.filter((r) => r.category === tab);
  const available = PROVIDERS.filter((p) => p.category === tab);
  const groups = useMemo(() => {
    if (tab !== "shipping") return [{ title: "", items: available }];
    return [
      { title: "Aggregators", items: available.filter((p) => p.kind === "aggregator") },
      { title: "Direct couriers", items: available.filter((p) => p.kind === "direct") },
    ];
  }, [tab, available]);

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Store, ads, couriers aur payment gateways connect karo. Ek category mein multiple accounts add kar sakte ho."
      />

      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {CATS.map((c) => {
          const Icon = CAT_ICON[c];
          const count = rows.filter((r) => r.category === c).length;
          return (
            <button
              key={c}
              onClick={() => setTab(c)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                tab === c ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-4" />
              {CATEGORY_LABELS[c]}
              {count > 0 && (
                <span className={cn("rounded-full px-1.5 text-xs", tab === c ? "bg-white/20" : "bg-muted")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <Card className="mb-6">
        <CardHeader title="Connected" description={`${CATEGORY_LABELS[tab]} accounts jo add ho chuke hain`} />
        {isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading…</p>
        ) : connected.length === 0 ? (
          <EmptyState icon={<Plug className="size-5" />} title="Abhi kuch connect nahi hai" description="Neeche se provider chuno" />
        ) : (
          <ul className="divide-y divide-border">
            {connected.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{r.label}</p>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.providerName}
                    {Object.entries(r.config)
                      .slice(0, 2)
                      .map(([k, v]) => ` · ${k}: ${v}`)}
                  </p>
                  {r.webhookUrl && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(r.webhookUrl!);
                        toast.success("Webhook URL copy ho gaya");
                      }}
                      className="mt-2 flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                      title="Copy webhook URL"
                    >
                      <Copy className="size-3 shrink-0" />
                      <span className="truncate">{r.webhookUrl}</span>
                    </button>
                  )}
                  {r.lastError && <p className="mt-2 text-xs text-danger">⚠ {r.lastError}</p>}
                  {getProvider(r.provider)?.capabilities?.sync && <IntegrationActions row={r} canManage={!!canManage} />}
                  {getProvider(r.provider)?.setupNote && <p className="mt-2 text-xs text-muted-foreground">ℹ️ {getProvider(r.provider)?.setupNote}</p>}
                  {r.category === "shipping" && !getProvider(r.provider)?.capabilities?.sync && (
                    <p className="mt-2 text-xs text-muted-foreground">ℹ️ Is courier ka API sync abhi nahi hai — Shipments page se invoice/MIS CSV import karo.</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const def = getProvider(r.provider);
                        if (def) setEditing({ def, row: r });
                      }}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => confirm(`"${r.label}" hata dein?`) && remove.mutate(r.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage &&
        groups.map((g) => (
          <div key={g.title || "all"} className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{g.title || "Add new"}</h3>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((p) => (
                <Card key={p.id} className="flex flex-col p-4">
                  <p className="font-medium">{p.name}</p>
                  <p className="mt-1 flex-1 text-sm text-muted-foreground">{p.description}</p>
                  <Button variant="outline" size="sm" className="mt-4 self-start" onClick={() => setEditing({ def: p })}>
                    <Plus className="size-3.5" /> Connect
                  </Button>
                </Card>
              ))}
            </div>
          </div>
        ))}

      {editing && <IntegrationDialog def={editing.def} row={editing.row} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface JobRow {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  progress?: { processed: number; message?: string };
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

const JOB_TONE = { queued: "gray", running: "indigo", done: "green", failed: "red" } as const;

function IntegrationActions({ row, canManage }: { row: IntegrationRow; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: jobs = [] } = useQuery({
    queryKey: ["integration-jobs", row.id],
    queryFn: async () => (await api.get<JobRow[]>(`/integrations/${row.id}/jobs`)).data,
    // chal rahe job ho to har 2 sec refresh
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "queued" || j.status === "running") ? 2000 : false),
  });
  const latest = jobs.find((j) => ["shopify.full_sync", "shopify.orders.sync", "courier.sync", "ads.sync"].includes(j.type));
  const caps = getProvider(row.provider)?.capabilities ?? {};
  const isShopify = row.provider === "shopify";
  const active = latest && (latest.status === "queued" || latest.status === "running");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["integrations"] });
    qc.invalidateQueries({ queryKey: ["integration-jobs", row.id] });
  };

  const test = useMutation({
    mutationFn: async () =>
      (await api.post<{ ok: boolean; error?: string; shop?: { name: string }; missingRequired?: string[]; missingOptional?: string[] }>(`/integrations/${row.id}/test`)).data,
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(r.shop ? `Connected: ${r.shop.name}` : "Connected ✓");
        if (r.missingOptional?.length) toast.warning(`Optional scopes missing: ${r.missingOptional.join(", ")}`);
      } else toast.error(r.error ?? `Missing scopes: ${r.missingRequired?.join(", ")}`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sync = useMutation({
    mutationFn: (full: boolean) => api.post(`/integrations/${row.id}/sync`, { full }),
    onSuccess: () => {
      toast.success("Sync shuru ho gaya");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const hooks = useMutation({
    mutationFn: async () =>
      (await api.post<{ ok: boolean; error?: string; created?: string[]; errors?: string[] }>(`/integrations/${row.id}/webhooks`)).data,
    onSuccess: (r) => {
      if (r.ok) toast.success(`Webhooks ready (${r.created?.length ?? 0} naye)`);
      else toast.error(r.error ?? r.errors?.join("; ") ?? "Webhook error");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {row.meta.shopName && <span>🛍 {row.meta.shopName}{row.meta.plan ? ` · ${row.meta.plan}` : ""}</span>}
        <span>Last sync: {fmtDateTime(row.lastSyncAt)}</span>
        {isShopify && <span>Webhooks: {row.meta.webhooksRegisteredAt ? `${row.meta.webhookTopics?.length ?? 0} topics ✓` : "not registered"}</span>}
      </div>
      {latest && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={JOB_TONE[latest.status]}>{latest.status}</Badge>
          <span className="text-muted-foreground">{latest.progress?.message ?? latest.type}</span>
          {latest.status === "failed" && latest.error && <span className="text-danger">{latest.error}</span>}
          {latest.status === "queued" && latest.error && <span className="text-warning">Retry #{latest.attempts}: {latest.error}</span>}
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
            <PlugZap className="size-3.5" /> Test
          </Button>
          <Button size="sm" variant="outline" disabled={row.status !== "connected" || !!active} loading={sync.isPending} onClick={() => sync.mutate(false)}>
            <RefreshCw className={cn("size-3.5", active && "animate-spin")} /> {active ? "Syncing…" : "Sync now"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={row.status !== "connected" || !!active}
            onClick={() => confirm("Poora data dobara sync karein?") && sync.mutate(true)}
          >
            Full resync
          </Button>
          {caps.registerWebhooks && (
            <Button size="sm" variant="outline" disabled={row.status !== "connected"} loading={hooks.isPending} onClick={() => hooks.mutate()}>
              <Webhook className="size-3.5" /> Webhooks
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function IntegrationDialog({ def, row, onClose }: { def: ProviderDef; row?: IntegrationRow; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!row;
  const [label, setLabel] = useState(row?.label ?? def.name);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of def.fields) init[f.key] = f.secret ? "" : (row?.config[f.key] ?? f.defaultValue ?? "");
    return init;
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = { provider: def.id, label, credentials: values };
      return isEdit ? api.put(`/integrations/${row.id}`, body) : api.post("/integrations", body);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Update ho gaya" : `${def.name} save ho gaya`);
      qc.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={`${isEdit ? "Edit" : "Connect"} ${def.name}`} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Label (pehchaan ke liye)" htmlFor="label" help="e.g. Main store, Shiprocket – Delhi warehouse">
          <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {def.fields.map((f) => {
            const existing = row?.maskedSecrets[f.key];
            const help = f.secret && existing ? `Saved: ${existing} — badalna ho tabhi likho` : f.help;
            return (
              <Field key={f.key} label={f.label + (f.required ? " *" : "")} htmlFor={f.key} help={help}>
                {f.type === "select" ? (
                  <Select id={f.key} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={f.key}
                    type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
                    step={f.type === "number" ? "any" : undefined}
                    autoComplete="off"
                    placeholder={f.secret && existing ? existing : f.placeholder}
                    required={f.required && !(f.secret && existing)}
                    value={values[f.key]}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                )}
              </Field>
            );
          })}
        </div>
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          🔒 Secret keys AES-256 se encrypt hokar save hoti hain aur kabhi poori wapas nahi dikhti.
          {def.docsUrl && (
            <>
              {" "}
              <a href={def.docsUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Credentials kaise milenge →
              </a>
            </>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
