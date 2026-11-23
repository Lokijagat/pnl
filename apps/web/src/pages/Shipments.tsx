import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, PackageSearch, Search, Upload } from "lucide-react";
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from "@pnl/shared";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";
import { normHeader, parseCsv } from "@/lib/csv";
import { useSession } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  provider: string;
  awb?: string;
  courierName?: string;
  orderId: string | null;
  orderName: string | null;
  orderRef: string | null;
  paymentMode: string | null;
  status: DeliveryStatus;
  statusRaw?: string;
  date?: string;
  zone?: string;
  state?: string;
  pincode?: string;
  weightGrams: number | null;
  isReverse: boolean;
  chargesSource: string;
  charges: { freight: number; cod: number; rto: number; reverse: number; weightDiscrepancy: number; other: number; gst: number; total: number };
  invoiceDiff: number | null;
}

export const STATUS_TONE: Record<DeliveryStatus, "gray" | "green" | "red" | "amber" | "indigo"> = {
  booked: "gray",
  in_transit: "indigo",
  out_for_delivery: "indigo",
  ndr: "amber",
  delivered: "green",
  rto_initiated: "red",
  rto_in_transit: "red",
  rto_delivered: "red",
  lost: "red",
  cancelled: "gray",
};
const SOURCE_LABEL: Record<string, string> = { api: "API", estimate: "≈ estimate", invoice: "Invoice", none: "—" };
const LIMIT = 50;

export function ShipmentsPage() {
  const { data: session } = useSession();
  const canEdit = ["owner", "admin", "accountant"].includes(session?.user.role ?? "");
  const [sp] = useSearchParams();
  const [unmatched, setUnmatched] = useState(sp.get("unmatched") === "1");
  const [statusGroup, setStatusGroup] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [unmatched, statusGroup, paymentMode, debounced]);

  const { data, isLoading } = useQuery({
    queryKey: ["shipments", unmatched, statusGroup, paymentMode, debounced, page],
    queryFn: async () =>
      (
        await api.get<{ total: number; rows: Row[] }>("/shipments", {
          params: {
            unmatched: unmatched ? "1" : undefined,
            statusGroup: statusGroup || undefined,
            paymentMode: paymentMode || undefined,
            q: debounced || undefined,
            page,
            limit: LIMIT,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / LIMIT));

  return (
    <div>
      <PageHeader
        title="Shipments"
        description="Couriers se aaye shipments aur unke charges. Kisi bhi courier ka invoice / MIS CSV upload karke actual charges daalo."
        action={
          canEdit && (
            <Button onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Courier CSV import
            </Button>
          )
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="AWB, order #, pincode" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="h-9 w-44" value={statusGroup} onChange={(e) => setStatusGroup(e.target.value)}>
          <option value="">All status</option>
          <option value="delivered">Delivered</option>
          <option value="rto">RTO</option>
          <option value="in_transit">In transit / NDR</option>
          <option value="cancelled">Cancelled / Lost</option>
        </Select>
        <Select className="h-9 w-40" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
          <option value="">All payments</option>
          <option value="prepaid">Prepaid</option>
          <option value="cod">COD</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={unmatched} onChange={(e) => setUnmatched(e.target.checked)} />
          Sirf unmatched
        </label>
        <span className="text-sm text-muted-foreground">{data?.total ?? 0} shipments</span>
      </Card>

      <Card>
        {isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<PackageSearch className="size-5" />} title="Koi shipment nahi" description="Courier sync karo ya CSV import karo." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">AWB / Courier</th>
                  <th className="px-3 py-3 font-medium">Order</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Zone / Pin</th>
                  <th className="px-3 py-3 text-right font-medium">Freight</th>
                  <th className="px-3 py-3 text-right font-medium">COD</th>
                  <th className="px-3 py-3 text-right font-medium">RTO</th>
                  <th className="px-3 py-3 text-right font-medium">Other</th>
                  <th className="px-3 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <p className="font-mono text-xs">{s.awb ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.courierName ?? s.provider}
                        {s.isReverse && " · reverse"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      {s.orderName ? (
                        <span className="font-medium">{s.orderName}</span>
                      ) : (
                        <Badge tone="amber">unmatched{s.orderRef ? ` · ${s.orderRef}` : ""}</Badge>
                      )}
                      <p className="text-xs uppercase text-muted-foreground">{s.paymentMode ?? ""}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[s.status]}>{DELIVERY_STATUS_LABELS[s.status]}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(s.date)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {s.zone ?? "—"} · {s.pincode ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">{inr(s.charges.freight, true)}</td>
                    <td className="px-3 py-2.5 text-right">{inr(s.charges.cod, true)}</td>
                    <td className="px-3 py-2.5 text-right">{inr(s.charges.rto, true)}</td>
                    <td className="px-3 py-2.5 text-right">{inr(s.charges.weightDiscrepancy + s.charges.reverse + s.charges.other, true)}</td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {inr(s.charges.total, true)}
                      {s.invoiceDiff != null && s.invoiceDiff !== 0 && (
                        <p className={cn("text-xs", s.invoiceDiff > 0 ? "text-danger" : "text-success")}>
                          {s.invoiceDiff > 0 ? "+" : ""}
                          {inr(s.invoiceDiff, true)} vs API
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{SOURCE_LABEL[s.chargesSource] ?? s.chargesSource}</td>
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
      <p className="mt-3 text-xs text-muted-foreground">
        Report:{" "}
        <Link to="/reports/delivery" className="text-primary hover:underline">
          Delivery Cost Report →
        </Link>
      </p>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}

/** Alag-alag courier MIS files ke column naam */
const ALIASES: Record<string, string[]> = {
  awb: ["awb", "awbno", "awbnumber", "awbcode", "waybill", "waybillno", "trackingnumber", "trackingid"],
  order: ["order", "orderid", "orderno", "ordernumber", "channelorderid", "referenceno", "refno", "clientorderid"],
  courier: ["courier", "couriername", "carrier", "courierpartner"],
  paymentMode: ["paymentmode", "payment", "paymentmethod", "ordertype", "paymenttype"],
  status: ["status", "currentstatus", "shipmentstatus", "deliverystatus"],
  shippedDate: ["shippeddate", "shipdate", "pickupdate", "pickeddate", "manifestdate", "date"],
  zone: ["zone"],
  weightKg: ["weightkg", "chargedweight", "chargeableweight", "weight", "billedweight"],
  pincode: ["pincode", "deliverypincode", "destinationpincode", "dpin", "customerpincode"],
  freight: ["freight", "freightcharges", "forwardcharges", "forwardfreight", "shippingcharges", "fwdcharges"],
  cod: ["cod", "codcharges", "codfee", "codamountcharges"],
  rto: ["rto", "rtocharges", "rtofreight", "returncharges"],
  reverse: ["reverse", "reversecharges", "reversepickup"],
  weightDiscrepancy: ["weightdiscrepancy", "excessweight", "excessweightcharges", "weightdispute"],
  other: ["other", "othercharges", "misc", "surcharge"],
  gst: ["gst", "tax", "igst", "gstamount"],
};

function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"shipments" | "invoice">("shipments");
  const [courierLabel, setCourierLabel] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapped, setMapped] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ rows: number; updated: number; created: number; notFoundCount: number; notFound: string[]; ordersUpdated: number } | null>(null);

  const onFile = async (file: File) => {
    setErr("");
    setResult(null);
    const data = parseCsv(await file.text());
    const header = (data[0] ?? []).map(normHeader);
    const idx: Record<string, number> = {};
    for (const [field, names] of Object.entries(ALIASES)) {
      const i = header.findIndex((h) => names.includes(h));
      if (i >= 0) idx[field] = i;
    }
    if (idx.awb === undefined) {
      setErr("AWB column nahi mila (awb / awb no / waybill / tracking number)");
      return;
    }
    setMapped(Object.keys(idx));
    const parsed = data
      .slice(1)
      .map((r) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, (r[i] ?? "").replace(/[₹,]/g, (m) => (m === "," && k !== "awb" ? "" : m === "₹" ? "" : m))])))
      .filter((r) => r.awb);
    if (!parsed.length) setErr("Koi row nahi mili");
    setRows(parsed);
  };

  const upload = useMutation({
    mutationFn: async () =>
      (
        await api.post("/shipments/import", {
          mode,
          courierLabel: courierLabel || "CSV",
          rows: rows.map((r) => ({
            ...r,
            weightKg: r.weightKg ? (Number(r.weightKg) > 50 ? Number(r.weightKg) / 1000 : Number(r.weightKg)) : 0, // grams diye ho to kg
          })),
        })
      ).data,
    onSuccess: (r) => {
      setResult(r);
      toast.success(`${r.updated + r.created} shipments update`);
      qc.invalidateQueries({ queryKey: ["shipments"] });
      qc.invalidateQueries({ queryKey: ["delivery-report"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const template = () => {
    const csv =
      "awb,order,courier,payment_mode,status,shipped_date,zone,weight_kg,pincode,freight,cod,rto,reverse,weight_discrepancy,other,gst\n" +
      "1234567890,#1001,Bluedart,COD,Delivered,2026-11-01,B,0.5,302001,48,30,0,0,0,0,14\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "courier-shipments-template.csv";
    a.click();
  };

  return (
    <Dialog open onClose={onClose} title="Courier CSV import" wide>
      <div className="space-y-4 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Import type">
            <Select value={mode} onChange={(e) => setMode(e.target.value as "shipments" | "invoice")}>
              <option value="shipments">Shipments + charges (naye AWB bhi banao)</option>
              <option value="invoice">Sirf invoice reconciliation (existing AWB)</option>
            </Select>
          </Field>
          <Field label="Courier naam (agar CSV mein nahi)">
            <Input placeholder="e.g. Bluedart" value={courierLabel} onChange={(e) => setCourierLabel(e.target.value)} />
          </Field>
        </div>
        <p className="text-muted-foreground">
          Amounts ₹ mein, <b>GST ke bina</b> (GST alag column mein). Existing AWB par ye charges <b>actual</b> maane jaate hain aur API/estimate ko override karte hain.
          Column names auto-detect hote hain (awb no, waybill, freight charges, cod charges, rto charges…).
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
        {err && <p className="text-danger">{err}</p>}
        {rows.length > 0 && !result && (
          <>
            <p className="text-xs text-muted-foreground">Detected columns: {mapped.join(", ")}</p>
            <div className="max-h-56 overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    {mapped.map((m) => (
                      <th key={m} className="px-2 py-2">
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i}>
                      {mapped.map((m) => (
                        <td key={m} className="px-2 py-1.5">
                          {r[m]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {result && (
          <div className="rounded-lg bg-muted p-3">
            <p>
              ✅ {result.updated} existing updated · {result.created} naye · {result.ordersUpdated} orders recalculated
            </p>
            {result.notFoundCount > 0 && (
              <p className="mt-1 text-warning">
                {result.notFoundCount} AWB nahi mile: {result.notFound.slice(0, 20).join(", ")}
                {result.notFoundCount > 20 ? "…" : ""}
              </p>
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
