import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/inventory/")({
  component: InventoryPage,
});

function InventoryPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-stone-400">
          SKU catalog and material instance ledger.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>No inventory yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-stone-400">
          Phase 1 of the build sequence imports your existing Excel data here.
        </CardContent>
      </Card>
    </div>
  );
}
