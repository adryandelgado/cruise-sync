import type { ProposalRow } from "@/hooks/useProposals";

export const PROPOSAL_STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "sent", label: "Sent" },
  { id: "approved", label: "Approved" },
  { id: "converted", label: "Converted" },
  { id: "rejected", label: "Rejected" },
] as const;

export function filterProposals(
  proposals: ProposalRow[],
  search: string,
  statusFilter: string,
): ProposalRow[] {
  const q = search.trim().toUpperCase();
  return proposals.filter((p) => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (!q) return true;
    const vessel = p.vessel?.name?.toUpperCase() ?? "";
    const fleet = p.vessel?.fleet?.name?.toUpperCase() ?? "";
    return (
      p.proposal_number.toUpperCase().includes(q) ||
      vessel.includes(q) ||
      fleet.includes(q)
    );
  });
}
