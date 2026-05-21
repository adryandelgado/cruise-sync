import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ClipboardList,
  Package,
  Ship,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";

import { HealthStatus } from "@/components/dashboard/HealthStatus";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/")({
  component: DashboardPage,
});

const STATS = [
  {
    label: "Open CSPOs",
    value: "0",
    hint: "Active financial containers",
    icon: ClipboardList,
    href: "/cspos" as const,
  },
  {
    label: "Value at sea",
    value: formatCurrency(0),
    hint: "Materials currently on vessels",
    icon: Wallet,
    href: "/cspos" as const,
  },
  {
    label: "Packing queue",
    value: "0",
    hint: "Jobs awaiting warehouse pick",
    icon: Package,
    href: "/warehouse" as const,
  },
  {
    label: "Procurement queue",
    value: "0",
    hint: "Items waiting on suppliers",
    icon: ShoppingCart,
    href: "/procurement" as const,
  },
  {
    label: "Today's deliveries",
    value: "0",
    hint: "Freight pickups scheduled",
    icon: Truck,
    href: "/warehouse" as const,
  },
  {
    label: "Vessels under service",
    value: "0",
    hint: "Ships with open work",
    icon: Ship,
    href: "/cspos" as const,
  },
];

function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-stone-400">ShipSync operations overview</p>
      </header>

      <HealthStatus />

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

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-stone-300">
            <p>
              1. Apply migrations 1–3 in the Supabase SQL editor (paste from{" "}
              <code className="font-mono text-xs">supabase/migrations/</code>
              ), then run <code className="font-mono text-xs">seed.sql</code>.
            </p>
            <p>
              2. The connection indicator above turns green once the schema is
              in place.
            </p>
            <p>
              3. Wire auth (email magic link), then replace these zeros with
              live queries.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>The transfer black hole</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-stone-400">
            When materials move directly between CSPOs — vessel to vessel —
            they vanish from every tool in use today. ShipSync tracks each{" "}
            <code className="font-mono text-xs">TransferEvent</code> with full
            $$ attribution, closing the accountability gap.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
