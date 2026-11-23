import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import {
  COMMISSION_TYPES,
  COMMISSION_TYPE_LABELS,
  marketingMemberSchema,
  type CommissionType,
  type MarketingMemberInput,
  type OrderScope,
} from "@pnl/shared";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

interface Member {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  platforms: ("meta" | "google")[];
  commissionType: CommissionType;
  commissionValue: number;
  orderScope: OrderScope;
  monthlyFixed: number;
  active: boolean;
}

const MAX_MEMBERS = 10;
const SCOPE_LABEL: Record<OrderScope, string> = {
  all: "Sabhi orders",
  meta: "Sirf Meta-attributed orders (UTM)",
  google: "Sirf Google-attributed orders (UTM)",
};
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

function describe(m: Member) {
  switch (m.commissionType) {
    case "per_order":
      return `${inr(m.commissionValue)} / order`;
    case "percent_revenue":
      return `${m.commissionValue}% of revenue`;
    case "percent_ad_spend":
      return `${m.commissionValue}% of ad spend`;
    case "percent_profit":
      return `${m.commissionValue}% of profit`;
    default:
      return "No commission";
  }
}

export function MarketingTeamPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const { data: members = [], isLoading } = useQuery({
    queryKey: ["marketing-members"],
    queryFn: async () => (await api.get<Member[]>("/marketing/members")).data,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/marketing/members/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing-members"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const active = members.filter((m) => m.active);
  const fixedTotal = active.reduce((s, m) => s + m.monthlyFixed, 0);
  const perOrderTotal = active.filter((m) => m.commissionType === "per_order").reduce((s, m) => s + m.commissionValue, 0);

  return (
    <div>
      <PageHeader
        title="Marketing Team"
        description="Meta / Google ads chalane wale log aur unka commission. Payout aur marketing cost per order: Marketing Report."
        action={
          <Button onClick={() => setEditing("new")} disabled={members.length >= MAX_MEMBERS}>
            <Plus className="size-4" /> Add member
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Active members</p>
          <p className="mt-2 text-2xl font-semibold">
            {active.length}
            <span className="text-base font-normal text-muted-foreground"> / {MAX_MEMBERS}</span>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Fixed / month</p>
          <p className="mt-2 text-2xl font-semibold">{inr(fixedTotal)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">Per-order commission (total)</p>
          <p className="mt-2 text-2xl font-semibold">{inr(perOrderTotal)}</p>
          <p className="text-xs text-muted-foreground">+ % based commissions report mein calculate honge</p>
        </Card>
      </div>

      <Card>
        {isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading…</p>
        ) : members.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-5" />}
            title="Koi marketing member nahi"
            description="Ad chalane wale employee add karo — per order ₹, revenue %, ad spend % ya profit % commission."
            action={<Button onClick={() => setEditing("new")}>Add member</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Platforms</th>
                  <th className="px-5 py-3 font-medium">Commission</th>
                  <th className="px-5 py-3 font-medium">Orders</th>
                  <th className="px-5 py-3 font-medium">Fixed / month</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.email || m.phone}</p>
                    </td>
                    <td className="space-x-1 px-5 py-3">
                      {m.platforms.map((p) => (
                        <Badge key={p} tone="indigo">
                          {p === "meta" ? "Meta" : "Google"}
                        </Badge>
                      ))}
                    </td>
                    <td className="px-5 py-3">{describe(m)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{SCOPE_LABEL[m.orderScope].split(" (")[0]}</td>
                    <td className="px-5 py-3">{inr(m.monthlyFixed)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={m.active ? "green" : "gray"}>{m.active ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          onClick={() => confirm(`${m.name} ko hata dein?`) && remove.mutate(m.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <MemberDialog member={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MemberDialog({ member, onClose }: { member?: Member; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState } = useForm<MarketingMemberInput>({
    resolver: zodResolver(marketingMemberSchema),
    defaultValues: member
      ? { ...member, email: member.email ?? "", phone: member.phone ?? "" }
      : {
          name: "",
          email: "",
          phone: "",
          platforms: ["meta"],
          commissionType: "per_order",
          commissionValue: 0,
          orderScope: "all",
          monthlyFixed: 0,
          active: true,
        },
  });
  const type = watch("commissionType");
  const e = formState.errors;

  const save = useMutation({
    mutationFn: (v: MarketingMemberInput) =>
      member ? api.put(`/marketing/members/${member.id}`, v) : api.post("/marketing/members", v),
    onSuccess: () => {
      toast.success("Save ho gaya");
      qc.invalidateQueries({ queryKey: ["marketing-members"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open onClose={onClose} title={member ? "Edit member" : "Add marketing member"} wide>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name *" error={e.name?.message}>
            <Input {...register("name")} />
          </Field>
          <Field label="Email" error={e.email?.message}>
            <Input type="email" {...register("email")} />
          </Field>
          <Field label="Phone" error={e.phone?.message}>
            <Input {...register("phone")} />
          </Field>
        </div>

        <Field label="Kaunse platform par ads chalata hai *" error={e.platforms?.message}>
          <div className="flex gap-4 pt-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" value="meta" {...register("platforms")} className="size-4 accent-primary" /> Meta
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" value="google" {...register("platforms")} className="size-4 accent-primary" /> Google
            </label>
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Commission type *">
            <Select {...register("commissionType")}>
              {COMMISSION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMMISSION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {type !== "none" && (
            <Field label={type === "per_order" ? "₹ per order *" : "Percent % *"} error={e.commissionValue?.message}>
              <Input type="number" step="any" {...register("commissionValue")} />
            </Field>
          )}
          <Field label="Commission kin orders par" help="UTM se attribution Phase 2 mein">
            <Select {...register("orderScope")}>
              {(Object.keys(SCOPE_LABEL) as OrderScope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fixed salary / month (₹)" error={e.monthlyFixed?.message}>
            <Input type="number" step="any" {...register("monthlyFixed")} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("active")} className="size-4 accent-primary" /> Active
        </label>

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
