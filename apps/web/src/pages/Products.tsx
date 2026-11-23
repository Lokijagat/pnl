import { useEffect, useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Boxes, Download, Pencil, Search, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, inr, todayIST } from "@/lib/format";
import { useSession } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { parseCsv } from "@/lib/csv";

interface VariantRow {
  id: string;
  productTitle: string;
  productStatus: string;
  imageUrl: string | null;
  title: string;
  sku: string;
  price: number;
  cogs: number | null;
  packing: number | null;
  shopifyUnitCost: number | null;
}
interface ListRes {
  total: number;
  missingCount: number;
  page: number;
  rows: VariantRow[];
}

const LIMIT = 50;

export function ProductsPage() {
  const { data: session } = useSession();
  const canEdit = ["owner", "admin", "accountant"].includes(session?.user.role ?? "");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<VariantRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["products", debounced, missing, page],
    queryFn: async () =>
      (await api.get<ListRes>("/products", { params: { q: debounced || undefined, missing: missing ? "1" : undefined, page, limit: LIMIT } })).data,
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / LIMIT));

  return (
    <div>
      <PageHeader
        title="Products & COGS"
        description="Har SKU ka purchase cost (COGS) aur packing cost. Cost badalne par purane orders us date se apne aap recalculate hote hain."
        action={
          canEdit && (
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> CSV import
            </Button>
          )
        }
      />

      <PackingSettings canEdit={canEdit} />

      {(data?.missingCount ?? 0) > 0 && (
        <button
          onClick={() => {
            setMissing(true);
            setPage(1);
          }}
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            <b>{data?.missingCount}</b> variants ka COGS missing hai. Inke orders ka profit galat dikhega — click karke dekho.
          </span>
        </button>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Product, variant ya SKU search karo" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={missing}
              onChange={(e) => {
                setMissing(e.target.checked);
                setPage(1);
              }}
            />
            Sirf cost missing
          </label>
          <span className="text-sm text-muted-foreground">{data?.total ?? 0} variants</span>
        </div>

        {isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Boxes className="size-5" />}
            title={debounced || missing ? "Kuch nahi mila" : "Abhi koi product nahi"}
            description={debounced || missing ? undefined : "Integrations par Shopify connect karke 'Sync now' dabao."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">COGS</th>
                  <th className="px-4 py-3 text-right font-medium">Packing</th>
                  <th className="px-4 py-3 text-right font-medium">Margin</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((v) => {
                  const cogs = v.cogs ?? v.shopifyUnitCost;
                  const fromShopify = v.cogs == null && v.shopifyUnitCost != null;
                  const margin = cogs != null && v.price > 0 ? ((v.price - cogs - (v.packing ?? 0)) / v.price) * 100 : null;
                  return (
                    <tr key={v.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {v.imageUrl ? (
                            <img src={v.imageUrl + "&width=80"} alt="" className="size-9 rounded-md border border-border object-cover" loading="lazy" />
                          ) : (
                            <div className="size-9 rounded-md bg-muted" />
                          )}
                          <div className="min-w-0">
                            <p className="max-w-xs truncate font-medium">{v.productTitle}</p>
                            <p className="text-xs text-muted-foreground">
                              {v.title !== "Default Title" ? v.title : ""}
                              {v.productStatus && v.productStatus !== "ACTIVE" && (
                                <span className="ml-1">
                                  <Badge>{v.productStatus.toLowerCase()}</Badge>
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{v.sku || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 text-right">{inr(v.price, true)}</td>
                      <td className="px-4 py-3 text-right">
                        {cogs == null ? (
                          <Badge tone="amber">missing</Badge>
                        ) : (
                          <span title={fromShopify ? "Shopify 'Cost per item' se" : undefined}>
                            {inr(cogs, true)}
                            {fromShopify && <span className="ml-1 text-xs text-muted-foreground">(Shopify)</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">{v.packing != null ? inr(v.packing, true) : "—"}</td>
                      <td className={cn("px-4 py-3 text-right font-medium", margin != null && margin < 0 && "text-danger")}>
                        {margin != null ? `${margin.toFixed(0)}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(v)}>
                            <Pencil className="size-3.5" /> Cost
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
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

      {editing && <CostDialog variant={editing} onClose={() => setEditing(null)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function PackingSettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get<{ packingPerOrder: number; syncDays: number }>("/settings")).data,
  });
  const [packing, setPacking] = useState("");
  const [days, setDays] = useState("");
  useEffect(() => {
    if (data) {
      setPacking(String(data.packingPerOrder));
      setDays(String(data.syncDays));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put("/settings", { packingPerOrder: packing, syncDays: days }),
    onSuccess: () => {
      toast.success("Settings save — orders recalculate ho rahe hain");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className="mb-6">
      <CardHeader title="Order-level costs" description="Har order par lagne wala packing (box, tape, bubble wrap, label, invoice, insert card)" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex flex-wrap items-end gap-4 p-5"
      >
        <div className="w-48">
          <Field label="Packing per order (₹)">
            <Input type="number" step="any" min="0" value={packing} disabled={!canEdit} onChange={(e) => setPacking(e.target.value)} />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Pehli sync (din)" help="Kitne din purane orders laane hain">
            <Input type="number" min="7" max="1095" value={days} disabled={!canEdit} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
        {canEdit && (
          <Button type="submit" loading={save.isPending} className="mb-5">
            Save
          </Button>
        )}
      </form>
    </Card>
  );
}

interface CostRow {
  id: string;
  cogs: number;
  packing: number;
  effectiveFrom: string;
}

function CostDialog({ variant, onClose }: { variant: VariantRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [cogs, setCogs] = useState(String(variant.cogs ?? variant.shopifyUnitCost ?? ""));
  const [packing, setPacking] = useState(String(variant.packing ?? 0));
  const [from, setFrom] = useState("2020-01-01");

  const { data: history = [] } = useQuery({
    queryKey: ["cost-history", variant.id],
    queryFn: async () => (await api.get<CostRow[]>(`/products/variants/${variant.id}/costs`)).data,
  });
  useEffect(() => {
    // pehli entry ho to "shuru se", warna aaj se
    if (history.length) setFrom(todayIST());
  }, [history.length]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["cost-history", variant.id] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const save = useMutation({
    mutationFn: () => api.post(`/products/variants/${variant.id}/costs`, { cogs, packing, effectiveFrom: from }),
    onSuccess: () => {
      toast.success("Cost save — orders recalculate ho rahe hain");
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/products/costs/${id}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open onClose={onClose} title={`Cost — ${variant.productTitle}${variant.title !== "Default Title" ? ` / ${variant.title}` : ""}`} wide>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          SKU: <span className="font-mono">{variant.sku || "—"}</span> · Price: {inr(variant.price, true)}
          {variant.shopifyUnitCost != null && <> · Shopify cost: {inr(variant.shopifyUnitCost, true)}</>}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="COGS / unit (₹) *">
            <Input type="number" step="any" min="0" required value={cogs} onChange={(e) => setCogs(e.target.value)} />
          </Field>
          <Field label="Packing / unit (₹)" help="Bottle, pouch, sticker">
            <Input type="number" step="any" min="0" value={packing} onChange={(e) => setPacking(e.target.value)} />
          </Field>
          <Field label="Effective from *" help="Is date se purane orders par bhi lagega">
            <Input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save cost
          </Button>
        </div>
      </form>

      {history.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-semibold">Cost history</h4>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-4 px-3 py-2">
                <span className="w-28 text-muted-foreground">{fmtDate(h.effectiveFrom)} se</span>
                <span>COGS {inr(h.cogs, true)}</span>
                <span className="text-muted-foreground">Packing {inr(h.packing, true)}</span>
                <Button variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => confirm("Ye entry hatayein?") && del.mutate(h.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<{ sku: string; cogs: string; packing: string; effectiveFrom: string }[]>([]);
  const [fileError, setFileError] = useState("");
  const [result, setResult] = useState<{ updatedVariants: number; unmatched: string[] } | null>(null);

  const onFile = async (file: File) => {
    setFileError("");
    setResult(null);
    const data = parseCsv(await file.text());
    const header = (data[0] ?? []).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
    const idx = { sku: header.indexOf("sku"), cogs: header.indexOf("cogs"), packing: header.indexOf("packing"), from: header.indexOf("effectivefrom") };
    if (idx.sku < 0 || idx.cogs < 0) {
      setFileError("Header mein 'sku' aur 'cogs' column chahiye");
      return;
    }
    const today = todayIST();
    const parsed = data.slice(1).map((r) => ({
      sku: r[idx.sku] ?? "",
      cogs: r[idx.cogs] ?? "",
      packing: idx.packing >= 0 ? (r[idx.packing] ?? "0") || "0" : "0",
      effectiveFrom: idx.from >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(r[idx.from] ?? "") ? r[idx.from]! : today,
    }));
    const valid = parsed.filter((r) => r.sku && r.cogs !== "" && !Number.isNaN(Number(r.cogs)));
    if (!valid.length) setFileError("Koi valid row nahi mili");
    setRows(valid);
  };

  const upload = useMutation({
    mutationFn: async () => (await api.post<{ updatedVariants: number; unmatched: string[] }>("/products/costs/import", { rows })).data,
    onSuccess: (r) => {
      setResult(r);
      toast.success(`${r.updatedVariants} variants update hue`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const template = () => {
    const csv = "sku,cogs,packing,effectiveFrom\nKAMA-OIL-100,120,8,2025-04-01\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "cogs-template.csv";
    a.click();
  };

  return (
    <Dialog open onClose={onClose} title="COGS CSV import" wide>
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Columns: <code>sku</code>, <code>cogs</code>, <code>packing</code> (optional), <code>effectiveFrom</code> (YYYY-MM-DD, optional, default aaj).
          Ek SKU multiple variants par ho to sab par lagega.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={template}>
            <Download className="size-3.5" /> Template
          </Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 font-medium hover:bg-muted">
            <Upload className="size-3.5" /> CSV chuno
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
        {fileError && <p className="text-danger">{fileError}</p>}
        {rows.length > 0 && !result && (
          <div className="max-h-56 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">COGS</th>
                  <th className="px-3 py-2">Packing</th>
                  <th className="px-3 py-2">From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 font-mono">{r.sku}</td>
                    <td className="px-3 py-1.5">{r.cogs}</td>
                    <td className="px-3 py-1.5">{r.packing}</td>
                    <td className="px-3 py-1.5">{r.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && (
          <div className="rounded-lg bg-muted p-3">
            <p>✅ {result.updatedVariants} variants update hue.</p>
            {result.unmatched.length > 0 && (
              <p className="mt-1 text-warning">Ye SKU nahi mile: {result.unmatched.slice(0, 30).join(", ")}{result.unmatched.length > 30 ? "…" : ""}</p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!result && (
            <Button disabled={!rows.length} loading={upload.isPending} onClick={() => upload.mutate()}>
              Import {rows.length || ""} rows
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
