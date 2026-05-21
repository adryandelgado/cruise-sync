import { createFileRoute } from "@tanstack/react-router";
import {
  ClipboardList,
  Package,
  ShoppingCart,
  Ship,
  Truck,
  Wallet,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

interface StatCard {
  label: string;
  value: string;
  hint: string;
  icon: typeof Ship;
}

// Placeholder data — wired to Supabase queries in a later phase.
const STATS: StatCard[] = [
  {
    label: "Open CSPOs",
    value: "0",
    hint: "Active financial containers",
    icon: ClipboardList,
  },
  {
    label: "Value at sea",
    value: formatCurrency(0),
    hint: "Materials currently on vessels",
    icon: Wallet,
  },
  {
    label: "Packing queue",
    value: "0",
    hint: "Jobs awaiting warehouse pick",
    icon: Package,
  },
  {
    label: "Procurement queue",
    value: "0",
    hint: "Items waiting on suppliers",
    icon: ShoppingCart,
  },
  {
    label: "Today's deliveries",
    value: "0",
    hint: "Freight pickups scheduled",
    icon: Truck,
  },
  {
    label: "Vessels under service",
    value: "0",
    hint: "Distinct ships with open work",
    icon: Ship,
  },
];

function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-stone-400">
          Live operational view. Connect Supabase to populate the numbers.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STATS.map(({ label, value, hint, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>{label}</CardTitle>
              <Icon className="h-4 w-4 text-stone-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight">
                {value}
              </div>
              <p className="mt-1 text-xs text-stone-500">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Next up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-stone-300">
            <p>
              1. Run the Phase 0 + Phase 1 SQL migrations in your Supabase
              project to create <code className="font-mono">fleets</code>,
              <code className="font-mono"> vessels</code>,
              <code className="font-mono"> skus</code>, and
              <code className="font-mono"> material_instances</code>.
            </p>
            <p>
              2. Generate types with{" "}
              <code className="font-mono">npm run db:types</code>.
            </p>
            <p>
              3. Build out the <strong>CSPO detail page</strong> — the anchor
              screen that proves the whole thesis.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>The transfer black hole</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-stone-400">
            When materials migrate directly from one CSPO to another without
            returning to the warehouse, they vanish from existing tooling.
            ShipSync tracks every <code className="font-mono">TransferEvent</code>{" "}
            with full $$ attribution — the single feature that closes the
            accountability gap.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
