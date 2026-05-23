import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCspos } from "@/hooks/useCspos";
import {
  CSPO_STATUS_FILTERS,
  cspoQuickAction,
  filterCspos,
} from "@/lib/cspoListFilters";
import {
  ensureCspoList,
  prefetchCspoDetailPage,
  prefetchCspoQuickAction,
  prefetchNewCspoForm,
} from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { cn, formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/cspos/")({
  loader: ({ context: { queryClient } }) => ensureCspoList(queryClient),
  component: CspoListPage,
});

function CspoListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: cspos, isPending, error } = useCspos();
  const loading = isInitialQueryLoad(isPending, cspos);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(
    () => filterCspos(cspos ?? [], search, statusFilter),
    [cspos, search, statusFilter],
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cruise Ship POs</h1>
          <p className="text-sm text-stone-400">
            Financial containers that follow materials through every state change.
          </p>
        </div>
        <Link to="/cspos/new" onMouseEnter={() => prefetchNewCspoForm(qc)}>
          <Button size="md">
            <Plus className="h-4 w-4" />
            New CSPO
          </Button>
        </Link>
      </header>

      {loading && (
        <div className="py-12 text-center text-sm text-stone-500">Loading…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!loading && !error && (!cspos || cspos.length === 0) && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="font-medium text-stone-300">No CSPOs yet</p>
            <p className="max-w-sm text-sm text-stone-500">
              A CSPO is created when a ship issues a Purchase Order for your
              services. Create the first one to get started.
            </p>
            <Link to="/cspos/new" onMouseEnter={() => prefetchNewCspoForm(qc)}>
              <Button className="mt-2">
                <Plus className="h-4 w-4" />
                Create your first CSPO
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {cspos && cspos.length > 0 && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Search PO #, vessel, fleet…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <p className="text-xs text-stone-500">
              {filtered.length} of {cspos.length} CSPOs
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {CSPO_STATUS_FILTERS.map(({ id, label }) => (
              <button
                key={id || "all"}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs",
                  statusFilter === id
                    ? "bg-stone-800 text-stone-100"
                    : "text-stone-500 hover:text-stone-300",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Card className="py-12 text-center text-sm text-stone-500">
              No CSPOs match your filters
            </Card>
          ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[min(70vh,720px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-stone-950">
              <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                <th className="px-4 py-3 font-medium">PO #</th>
                <th className="px-4 py-3 font-medium">Vessel</th>
                <th className="px-4 py-3 font-medium">Fleet</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Value</th>
                <th className="px-4 py-3 font-medium">Planned</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {filtered.map((c) => {
                const action = cspoQuickAction(c);
                return (
                <tr
                  key={c.id}
                  className="group cursor-pointer transition-colors hover:bg-stone-900/60"
                  onMouseEnter={() => prefetchCspoDetailPage(qc, c.id)}
                  onClick={() => void navigate({ to: "/cspos/$cspoId", params: { cspoId: c.id } })}
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/cspos/$cspoId"
                      params={{ cspoId: c.id }}
                      className="font-mono text-brand-400 hover:text-brand-300"
                      onClick={(e) => e.stopPropagation()}
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
                  <td className="px-4 py-3 text-right">
                    {action && (
                      <Link
                        to={action.to}
                        params={{ cspoId: action.cspoId }}
                        onMouseEnter={() =>
                          prefetchCspoQuickAction(qc, action.to, action.cspoId)
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100">
                          {action.label}
                        </Button>
                      </Link>
                    )}
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
          </div>
        </Card>
          )}
        </>
      )}
    </div>
  );
}
