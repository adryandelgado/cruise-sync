import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/cspos/")({
  component: CspoListPage,
});

function CspoListPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cruise Ship POs
        </h1>
        <p className="text-sm text-stone-400">
          The financial container that follows materials through every state
          change.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>No CSPOs yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-stone-400">
          Once the schema is in place, this view will list every active CSPO
          with its vessel, attendance type, original value, and live open
          balance.
        </CardContent>
      </Card>
    </div>
  );
}
