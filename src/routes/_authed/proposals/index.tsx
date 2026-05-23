import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { JobListToolbar } from "@/components/shared/JobListToolbar";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useProposals } from "@/hooks/useProposals";
import {
  filterProposals,
  PROPOSAL_STATUS_FILTERS,
} from "@/lib/proposalListFilters";
import { prefetchProposalDetail, ensureProposalsHub, prefetchFormPickers } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/proposals/")({
  loader: ({ context: { queryClient } }) => ensureProposalsHub(queryClient),
  component: ProposalsPage,
});

const proposalBadgeVariant = (status: string) => {
  switch (status) {
    case "approved":
      return "on_vessel" as const;
    case "sent":
      return "active" as const;
    case "rejected":
      return "cancelled" as const;
    case "converted":
      return "closed" as const;
    default:
      return "draft" as const;
  }
};

function ProposalsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proposals, isPending, error } = useProposals();
  const loading = isInitialQueryLoad(isPending, proposals);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(
    () => filterProposals(proposals ?? [], search, statusFilter),
    [proposals, search, statusFilter],
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
          <p className="text-sm text-stone-400">
            Drafts sent to ships. Approved proposals convert into CSPOs.
          </p>
        </div>
        <Link to="/proposals/new" onMouseEnter={() => prefetchFormPickers(qc)}>
          <Button size="md">
            <Plus className="h-4 w-4" />
            New proposal
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

      {!loading && !error && (!proposals || proposals.length === 0) && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="font-medium text-stone-300">No proposals yet</p>
            <p className="max-w-sm text-sm text-stone-500">
              Create a proposal with scope and line items. When the ship approves,
              activate it as a CSPO with one click.
            </p>
            <Link to="/proposals/new" onMouseEnter={() => prefetchFormPickers(qc)}>
              <Button className="mt-2">
                <Plus className="h-4 w-4" />
                Create your first proposal
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {proposals && proposals.length > 0 && (
        <>
          <JobListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search proposal #, vessel, fleet…"
            filters={[...PROPOSAL_STATUS_FILTERS]}
            activeFilter={statusFilter}
            onFilter={setStatusFilter}
            count={filtered.length}
            total={proposals.length}
            countLabel="proposals"
          />

          {filtered.length === 0 ? (
            <Card className="py-12 text-center text-sm text-stone-500">
              No proposals match your filters
            </Card>
          ) : (
        <Card className="overflow-hidden">
          <div className="max-h-[min(70vh,720px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-stone-950">
              <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                <th className="px-4 py-3 font-medium">Proposal #</th>
                <th className="px-4 py-3 font-medium">Vessel</th>
                <th className="px-4 py-3 font-medium">Fleet</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Value</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer hover:bg-stone-900/40"
                  onMouseEnter={() => prefetchProposalDetail(qc, p.id)}
                  onClick={() =>
                    void navigate({ to: "/proposals/$proposalId", params: { proposalId: p.id } })
                  }
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/proposals/$proposalId"
                      params={{ proposalId: p.id }}
                      className="font-mono text-brand-400 hover:text-brand-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.proposal_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-stone-200">
                    {p.vessel?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-stone-400">
                    {p.vessel?.fleet?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={proposalBadgeVariant(p.status)}>
                      {statusLabel(p.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(p.total_value, p.currency)}
                  </td>
                  <td className="px-4 py-3 text-stone-400">
                    {new Date(p.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
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
