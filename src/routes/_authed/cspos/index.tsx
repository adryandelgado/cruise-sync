import { Link, createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCspos } from "@/hooks/useCspos";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/cspos/")({
  component: CspoListPage,
});

function CspoListPage() {
  const { data: cspos, isLoading, error } = useCspos();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cruise Ship POs</h1>
          <p className="text-sm text-stone-400">
            Financial containers that follow materials through every state change.
          </p>
        </div>
        <Link to="/cspos/new">
          <Button size="md">
            <Plus className="h-4 w-4" />
            New CSPO
          </Button>
        </Link>
      </header>

      {isLoading && (
        <div className="py-12 text-center text-sm text-stone-500">Loading…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!isLoading && !error && (!cspos || cspos.length === 0) && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="font-medium text-stone-300">No CSPOs yet</p>
            <p className="max-w-sm text-sm text-stone-500">
              A CSPO is created when a ship issues a Purchase Order for your
              services. Create the first one to get started.
            </p>
            <Link to="/cspos/new">
              <Button className="mt-2">
                <Plus className="h-4 w-4" />
                Create your first CSPO
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {cspos && cspos.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                <th className="px-4 py-3 font-medium">PO #</th>
                <th className="px-4 py-3 font-medium">Vessel</th>
                <th className="px-4 py-3 font-medium">Fleet</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Value</th>
                <th className="px-4 py-3 font-medium">Planned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {cspos.map((c) => (
                <tr
                  key={c.id}
                  className="group cursor-pointer transition-colors hover:bg-stone-900/60"
                  onClick={() => void 0}
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/cspos/$cspoId"
                      params={{ cspoId: c.id }}
                      className="font-mono text-brand-400 hover:text-brand-300"
                    >
                      {c.cspo_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-stone-200">
                    {c.vessel?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-400">
                    {c.vessel?.fleet?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        c.attendance_type === "in_service"
                          ? "in_service"
                          : "in_drydock"
                      }
                    >
                      {c.attendance_type === "in_service"
                        ? "In Service"
                        : "In Drydock"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={c.status as Parameters<typeof Badge>[0]["variant"]}>
                      {statusLabel(c.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-stone-200">
                    {formatCurrency(c.original_value, c.currency)}
                  </td>
                  <td className="px-4 py-3 text-stone-400">
                    {c.planned_start
                      ? new Date(c.planned_start).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                    {c.planned_end
                      ? ` → ${new Date(c.planned_end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
