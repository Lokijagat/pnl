import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { ROLES, inviteUserSchema, type InviteUserInput, type Role } from "@pnl/shared";
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/hooks/useAuth";

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  lastLoginAt?: string;
}

const ROLE_HELP: Record<Role, string> = {
  owner: "Sab kuch",
  admin: "Integrations, team, costs",
  accountant: "Costs + reports",
  marketer: "Sirf reports dekh sakta hai",
  viewer: "Sirf reports dekh sakta hai",
};

export function TeamPage() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canManage = session?.user.role === "owner" || session?.user.role === "admin";
  const [open, setOpen] = useState(false);
  const { data: users = [] } = useQuery({
    queryKey: ["team"],
    queryFn: async () => (await api.get<TeamUser[]>("/team")).data,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/team/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title="Users"
        description="Apne brand dashboard ka access team ko do"
        action={
          canManage && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Add user
            </Button>
          )
        }
      />
      <Card>
        <ul className="divide-y divide-border">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-4 p-4">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {u.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{u.name}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <Badge tone={u.role === "owner" ? "indigo" : "gray"}>{u.role}</Badge>
              {canManage && u.role !== "owner" && u.id !== session?.user.id && (
                <Button variant="ghost" size="sm" className="text-danger" onClick={() => confirm(`${u.name} ko hata dein?`) && remove.mutate(u.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {open && <AddUserDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function AddUserDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, watch, formState } = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { role: "viewer" },
  });
  const e = formState.errors;
  const save = useMutation({
    mutationFn: (v: InviteUserInput) => api.post("/team", v),
    onSuccess: () => {
      toast.success("User add ho gaya");
      qc.invalidateQueries({ queryKey: ["team"] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const role = watch("role");

  return (
    <Dialog open onClose={onClose} title="Add user">
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <Field label="Name" error={e.name?.message}>
          <Input {...register("name")} />
        </Field>
        <Field label="Email" error={e.email?.message}>
          <Input type="email" {...register("email")} />
        </Field>
        <Field label="Role" help={role ? ROLE_HELP[role] : undefined}>
          <Select {...register("role")}>
            {ROLES.filter((r) => r !== "owner").map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Temporary password" error={e.password?.message}>
          <Input type="password" autoComplete="new-password" {...register("password")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Add
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
