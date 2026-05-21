import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/proposals/")({
  component: ProposalsPage,
});

function ProposalsPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
        <p className="text-sm text-stone-400">
          Drafts sent to ships. Approved proposals convert into CSPOs.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>No proposals yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-stone-400">
          Phase 2 of the build sequence wires this up.
        </CardContent>
      </Card>
    </div>
  );
}
