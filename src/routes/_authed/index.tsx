import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Package, Ship, ShoppingCart, Truck, Wallet } from "lucide-react";
import { HealthStatus } from "@/components/dashboard/HealthStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useAuth } from "@/context/AuthContext";
import { canAccessNavRoute, canCreateCspo } from "@/lib/navAccess";
import { ensureDashboardStats, prefetchNewCspoForm } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/")({
  loader: ({ context: { queryClient } }) => ensureDashboardStats(queryClient),
  component: DashboardPage,
});

function DashboardPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { data: stats, isPending, error } = useDashboardStats();
  const loading = isInitialQueryLoad(isPending, stats);
  const showNewCspo = canCreateCspo(profile?.role);

  const STATS = [
    {
      label: "Open CSPOs",
      value: stats ? String(stats.openCspos) : "—",
      hint: "Active financial containers",
      icon: ClipboardList,
      href: "/cspos" as const,
    },
    {
      label: "Value at sea",
      value: stats ? formatCurrency(stats.valueAtSea) : "—",
      hint: "Materials currently on vessels",
      icon: Wallet,
      href: "/cspos" as const,
    },
    {
      label: "Packing queue",
      value: stats ? String(stats.packingQueue) : "—",
      hint: "Jobs awaiting warehouse pick",
      icon: Package,
      href: "/warehouse" as const,
    },
    {
      label: "Procurement queue",
      value: stats ? String(stats.procurementQueue) : "—",
      hint: "Items waiting on suppliers",
      icon: ShoppingCart,
      href: "/procurement" as const,
    },
    {
      label: "Today's deliveries",
      value: stats ? String(stats.todaysDeliveries) : "—",
      hint: "Shipments in transit awaiting receipt",
      icon: Truck,
      href: "/onboard" as const,
    },
    {
      label: "Vessels under service",
      value: stats ? String(stats.vesselsUnderService) : "—",
      hint: "Ships with open work",
      icon: Ship,
      href: "/cspos" as const,
    },
  ].filter((stat) => canAccessNavRoute(profile?.role, stat.href));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-stone-400">ShipSync operations overview</p>
        </div>
        {showNewCspo && (
          <Link
            to="/cspos/new"
            onMouseEnter={() => prefetchNewCspoForm(qc)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
          >
            + New CSPO
          </Link>
        )}
      </header>

      <HealthStatus />

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          Could not load dashboard stats: {error.message}
        </div>
      )}

      {loading && !stats && (
        <p className="text-sm text-stone-500">Loading stats…</p>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STATS.map(({ label, value, hint, icon: Icon, href }) => (
          <Link key={label} to={href}>
            <Card className="transition-colors hover:border-stone-700">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle>{label}</CardTitle>
                <Icon className="h-4 w-4 text-stone-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tracking-tight">{value}</div>
                <p className="mt-1 text-xs text-stone-500">{hint}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
