import type { QueryClient } from "@tanstack/react-query";
import type { ProposalRow } from "@/hooks/useProposals";

export const PROPOSALS_QUERY_KEY = ["proposals"] as const;

export function patchProposalsPrepend(qc: QueryClient, row: ProposalRow) {
  qc.setQueryData<ProposalRow[]>(PROPOSALS_QUERY_KEY, (old) => {
    if (!old) return old;
    if (old.some((existing) => existing.id === row.id)) return old;
    return [row, ...old];
  });
}

export function patchProposalStatus(
  qc: QueryClient,
  proposalId: string,
  status: string,
  extra?: Partial<Pick<ProposalRow, "sent_at" | "approved_at">>,
) {
  qc.setQueryData<ProposalRow[]>(PROPOSALS_QUERY_KEY, (old) => {
    if (!old) return old;
    return old.map((row) =>
      row.id === proposalId ? { ...row, status, ...extra } : row,
    );
  });

  qc.setQueryData<ProposalDetailCache>(
    ["proposals", proposalId],
    (old) => {
      if (!old?.proposal) return old;
      return {
        ...old,
        proposal: { ...old.proposal, status, ...extra },
      };
    },
  );
}

export type ProposalDetailCache = {
  proposal: Record<string, unknown>;
  lines: unknown[];
};

export function patchProposalDetailSeed(
  qc: QueryClient,
  proposalId: string,
  detail: ProposalDetailCache,
) {
  qc.setQueryData(["proposals", proposalId], detail);
}
