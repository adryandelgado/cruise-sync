import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/warehouse/")({
  component: WarehousePage,
});

function WarehousePage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Warehouse</h1>
        <p className="text-sm text-stone-400">
          Pack queue and operator assignments. The tablet view is at{" "}
          <code className="font-mono">/warehouse/pack</code>.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>No active jobs</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-stone-400">
          Phase 3 of the build sequence wires the tablet pack flow.
        </CardContent>
      </Card>
    </div>
  );
}
