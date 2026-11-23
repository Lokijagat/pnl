import { useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Plug,
  Receipt,
  ShoppingBag,
  Truck,
  Users,
  Loader2,
  PackageSearch,
  TrendingUp,
} from "lucide-react";
import { useLogout, useSession } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/orders", label: "Orders", icon: ShoppingBag },
  { to: "/reports/pnl", label: "P&L Report", icon: BarChart3 },
  { to: "/reports/delivery", label: "Delivery Cost", icon: Truck },
  { to: "/shipments", label: "Shipments", icon: PackageSearch },
  { to: "/reports/marketing", label: "Marketing Report", icon: TrendingUp },
  { to: "/products", label: "Products & COGS", icon: Boxes },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/marketing-team", label: "Marketing Team", icon: Megaphone },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/team", label: "Users", icon: Users },
];

export function AppLayout() {
  const { data: session, isLoading } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (isLoading)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!session) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">P</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">ProfitLens</p>
            <p className="truncate text-xs text-muted-foreground">{session.tenant.name}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 px-3">
            <p className="truncate text-sm font-medium">{session.user.name}</p>
            <p className="truncate text-xs capitalize text-muted-foreground">{session.user.role}</p>
          </div>
          <button
            onClick={() => logout.mutate(undefined, { onSettled: () => navigate("/login") })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" /> Logout
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-2 hover:bg-muted" aria-label="Menu">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">ProfitLens</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
