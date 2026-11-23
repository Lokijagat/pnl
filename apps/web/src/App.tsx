import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { LoginPage } from "@/pages/Login";
import { SignupPage } from "@/pages/Signup";
import { DashboardPage } from "@/pages/Dashboard";
import { IntegrationsPage } from "@/pages/Integrations";
import { MarketingTeamPage } from "@/pages/MarketingTeam";
import { TeamPage } from "@/pages/Team";
import { ComingSoon } from "@/pages/ComingSoon";
import { OrdersPage } from "@/pages/Orders";
import { ProductsPage } from "@/pages/Products";
import { DeliveryReportPage } from "@/pages/DeliveryReport";
import { ShipmentsPage } from "@/pages/Shipments";
import { MarketingReportPage } from "@/pages/MarketingReport";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="marketing-team" element={<MarketingTeamPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="reports/delivery" element={<DeliveryReportPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="reports/marketing" element={<MarketingReportPage />} />
        <Route
          path="reports/pnl"
          element={<ComingSoon title="P&L Report" phase="Phase 5" description="Revenue → CM1 → CM2 → CM3 → Net profit, daily/weekly/monthly + export." />}
        />
        <Route
          path="expenses"
          element={<ComingSoon title="Expenses" phase="Phase 5" description="Rent, salary, bijli, AI tools, Shopify plan, CA fees — recurring entries ke saath." />}
        />
        <Route path="*" element={<ComingSoon title="Not found" phase="—" description="Ye page exist nahi karta." />} />
      </Route>
    </Routes>
  );
}
