import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "@/hooks/useAuth";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { data: session, isLoading } = useSession();
  if (!isLoading && session) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-indigo-600 to-violet-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/20 font-bold">P</div>
          <span className="text-lg font-semibold">ProfitLens</span>
        </div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">
            Har order ka asli profit.
            <br />
            Ek dashboard mein.
          </h2>
          <p className="mt-4 max-w-md text-indigo-100">
            Shopify, Meta, Google Ads, Shiprocket, Delhivery aur payment gateways ko jodo — COGS, packing, shipping,
            RTO, GST aur fixed costs ke baad net profit dekho.
          </p>
        </div>
        <p className="text-sm text-indigo-200">© {new Date().getFullYear()} ProfitLens</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
