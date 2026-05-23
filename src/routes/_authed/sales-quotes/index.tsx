import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { JobListToolbar } from "@/components/shared/JobListToolbar";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSalesQuotes } from "@/hooks/useProcurement";
import {
  filterSalesQuotes,
  SALES_QUOTE_STATUS_FILTERS,
  salesQuoteBadgeVariant,
  salesQuoteVesselName,
} from "@/lib/salesQuoteListFilters";
import { prefetchSalesQuoteDetail, ensureSalesQuotesHub, prefetchFormPickers } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/sales-quotes/")({
  loader: ({ context: { queryClient } }) => ensureSalesQuotesHub(queryClient),
  component: SalesQuotesPage,
});

function SalesQuotesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: quotes, isPending, error } = useSalesQuotes();
  const loading = isInitialQueryLoad(isPending, quotes);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(
    () => filterSalesQuotes(quotes ?? [], search, statusFilter),
    [quotes, search, statusFilter],
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales quotes</h1>
          <p className="text-sm text-stone-400">
            Parts-only sales to cruise lines (separate from service proposals).
          </p>
        </div>
        <Link to="/sales-quotes/new" onMouseEnter={() => prefetchFormPickers(qc)}>
          <Button>
            <Plus className="h-4 w-4" /> New quote
          </Button>
        </Link>
      </header>

      {loading && <div className="py-12 text-center text-sm text-stone-500">Loading…</div>}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!loading && !error && (!quotes || quotes.length === 0) && (
        <Card className="py-16 text-center text-sm text-stone-500">
          No sales quotes yet.{" "}
          <Link
            to="/sales-quotes/new"
            onMouseEnter={() => prefetchFormPickers(qc)}
            className="text-brand-400 hover:underline"
          >
            Create your first quote
          </Link>
          .
        </Card>
      )}

      {quotes && quotes.length > 0 && (
        <>
          <JobListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search quote #, vessel, fleet…"
            filters={[...SALES_QUOTE_STATUS_FILTERS]}
            activeFilter={statusFilter}
            onFilter={setStatusFilter}
            count={filtered.length}
            total={quotes.length}
            countLabel="quotes"
          />

          {filtered.length === 0 ? (
            <Card className="py-12 text-center text-sm text-stone-500">
              No quotes match your filters
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="max-h-[min(70vh,720px)] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-stone-950">
                    <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                      <th className="px-4 py-3 font-medium">Quote #</th>
                      <th className="px-4 py-3 font-medium">Vessel</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Total</th>
                      <th className="px-4 py-3 font-medium">Valid until</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800/60">
                    {filtered.map((q) => (
                        <tr
                          key={q.id}
                          className="cursor-pointer hover:bg-stone-900/40"
                          onMouseEnter={() => prefetchSalesQuoteDetail(qc, q.id)}
                          onClick={() =>
                            void navigate({
                              to: "/sales-quotes/$quoteId",
                              params: { quoteId: q.id },
                            })
                          }
                        >
                          <td className="px-4 py-3">
                            <Link
                              to="/sales-quotes/$quoteId"
                              params={{ quoteId: q.id }}
                              className="font-mono text-brand-400 hover:text-brand-300"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {q.quote_number}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-stone-200">{salesQuoteVesselName(q)}</td>
                          <td className="px-4 py-3">
                            <Badge variant={salesQuoteBadgeVariant(q.status)}>
                              {statusLabel(q.status)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {formatCurrency(Number(q.total), q.currency)}
                          </td>
                          <td className="px-4 py-3 text-stone-400">
                            {q.valid_until
                              ? new Date(q.valid_until).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : "—"}
                          </td>
                        </tr>
                    ))}
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
