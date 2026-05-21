import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/procurement/")({
  component: ProcurementPage,
});

function ProcurementPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Procurement</h1>
        <p className="text-sm text-stone-400">
          Stock-outs flagged from the warehouse drop into this queue.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>No open requests</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-stone-400">
          Material list items marked &ldquo;not in stock&rdquo; create
          procurement requests here.
        </CardContent>
      </Card>
    </div>
  );
}
