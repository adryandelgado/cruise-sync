import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { seedMaterialListFromProposal } from "@/hooks/useMaterialList";
import { patchCspoListAfterCreate, mapCspoInsertRow } from "@/lib/cspoListCache";
import { patchDashboardAfterCspoCreated } from "@/lib/dashboardStatsCache";
import {
  buildCspoPnlRowFromCreate,
  patchCspoPnlReportPrepend,
  patchReportsOverviewDelta,
} from "@/lib/reportsCache";
import {
  patchProposalDetailSeed,
  patchProposalStatus,
  patchProposalsPrepend,
  PROPOSALS_QUERY_KEY,
} from "@/lib/proposalsCache";

export type ProposalRow = {
  id: string;
  proposal_number: string;
  status: string;
  total_value: number;
  currency: string;
  scope_summary: string | null;
  sent_at: string | null;
  approved_at: string | null;
  created_at: string;
  vessel: {
    id: string;
    name: string;
    fleet: { id: string; name: string } | null;
  } | null;
};

export type ProposalLineRow = {
  id: string;
  sku_id: string | null;
  custom_description: string | null;
  qty: number;
  unit_price: number;
  sku: { id: string; sku_code: string; name: string } | null;
};

export async function fetchProposals(): Promise<ProposalRow[]> {
  const { data, error } = await supabase()
    .from("proposals")
    .select(`
      id, proposal_number, status, total_value, currency,
      scope_summary, sent_at, approved_at, created_at,
      vessel:vessels(id, name, fleet:fleets(id, name))
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as unknown as ProposalRow[];
}

export function useProposals() {
  return useQuery({
    queryKey: PROPOSALS_QUERY_KEY,
    queryFn: fetchProposals,
  });
}

export async function fetchProposal(id: string) {
  const [proposalRes, linesRes] = await Promise.all([
    supabase()
      .from("proposals")
      .select(`
        id, proposal_number, status, total_value, currency,
        scope_summary, sent_at, approved_at, created_at, vessel_id,
        vessel:vessels(id, name, fleet:fleets(id, name))
      `)
      .eq("id", id)
      .single(),
    supabase()
      .from("proposal_line_items")
      .select(`
        id, sku_id, custom_description, qty, unit_price,
        sku:skus(id, sku_code, name)
      `)
      .eq("proposal_id", id)
      .order("created_at"),
  ]);

  if (proposalRes.error) throw proposalRes.error;
  return {
    proposal: proposalRes.data,
    lines: (linesRes.data ?? []) as unknown as ProposalLineRow[],
  };
}

export function useProposal(id: string) {
  return useQuery({
    queryKey: ["proposals", id],
    queryFn: () => fetchProposal(id),
  });
}

export type CreateProposalInput = {
  proposal_number: string;
  vessel_id: string;
  scope_summary?: string;
  currency: string;
  lines: Array<{
    sku_id?: string;
    custom_description?: string;
    qty: number;
    unit_price: number;
  }>;
};

export function useCreateProposal() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateProposalInput) => {
      if (!profile) throw new Error("Not authenticated");
      if (!input.lines.length) throw new Error("Add at least one line item");

      const total = input.lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0);

      const { data: proposal, error: propErr } = await supabase()
        .from("proposals")
        .insert({
          org_id: profile.org_id,
          proposal_number: input.proposal_number.trim(),
          vessel_id: input.vessel_id,
          scope_summary: input.scope_summary?.trim() || null,
          total_value: total,
          currency: input.currency,
          created_by: profile.id,
        })
        .select(`
          id, proposal_number, status, total_value, currency,
          scope_summary, sent_at, approved_at, created_at,
          vessel:vessels(id, name, fleet:fleets(id, name))
        `)
        .single();

      if (propErr) throw propErr;

      const { data: insertedLines, error: linesErr } = await supabase()
        .from("proposal_line_items")
        .insert(
          input.lines.map((line) => ({
            org_id: profile.org_id,
            proposal_id: proposal.id,
            sku_id: line.sku_id ?? null,
            custom_description: line.custom_description ?? null,
            qty: line.qty,
            unit_price: line.unit_price,
          })),
        )
        .select(`
          id, sku_id, custom_description, qty, unit_price,
          sku:skus(id, sku_code, name)
        `);

      if (linesErr) throw linesErr;

      const vesselRaw = proposal.vessel as unknown;
      const vessel = Array.isArray(vesselRaw)
        ? ((vesselRaw[0] ?? null) as ProposalRow["vessel"])
        : (vesselRaw as ProposalRow["vessel"]);

      const listRow = {
        id: proposal.id,
        proposal_number: proposal.proposal_number,
        status: proposal.status,
        total_value: Number(proposal.total_value),
        currency: proposal.currency,
        scope_summary: proposal.scope_summary,
        sent_at: proposal.sent_at,
        approved_at: proposal.approved_at,
        created_at: proposal.created_at,
        vessel,
      } satisfies ProposalRow;

      return {
        listRow,
        detail: {
          proposal: {
            ...proposal,
            total_value: Number(proposal.total_value),
            vessel,
          },
          lines: (insertedLines ?? []) as unknown as ProposalLineRow[],
        },
      };
    },
    onSuccess: ({ listRow, detail }) => {
      patchProposalsPrepend(qc, listRow);
      patchProposalDetailSeed(qc, listRow.id, detail);
    },
  });
}

export function useUpdateProposalStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "sent" | "approved" | "rejected";
    }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "sent") patch.sent_at = new Date().toISOString();
      if (status === "approved") patch.approved_at = new Date().toISOString();

      const { error } = await supabase()
        .from("proposals")
        .update(patch)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      const now = new Date().toISOString();
      patchProposalStatus(qc, vars.id, vars.status, {
        ...(vars.status === "sent" ? { sent_at: now } : {}),
        ...(vars.status === "approved" ? { approved_at: now } : {}),
      });
    },
  });
}

export type ActivateFromProposalInput = {
  proposalId: string;
  cspo_number: string;
  attendance_type: "in_service" | "in_drydock";
  port_of_service?: string;
  planned_start?: string;
  planned_end?: string;
};

export function useActivateFromProposal() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: ActivateFromProposalInput) => {
      if (!profile) throw new Error("Not authenticated");

      const { data: proposal, error: propErr } = await supabase()
        .from("proposals")
        .select("id, vessel_id, total_value, currency, status")
        .eq("id", input.proposalId)
        .single();

      if (propErr) throw propErr;
      if (proposal.status !== "approved") {
        throw new Error("Proposal must be approved before activating a CSPO");
      }

      const { data: cspo, error: cspoErr } = await supabase()
        .from("cruise_ship_pos")
        .insert({
          org_id: profile.org_id,
          cspo_number: input.cspo_number.trim(),
          vessel_id: proposal.vessel_id,
          proposal_id: input.proposalId,
          attendance_type: input.attendance_type,
          port_of_service: input.port_of_service ?? null,
          planned_start: input.planned_start ?? null,
          planned_end: input.planned_end ?? null,
          original_value: proposal.total_value,
          currency: proposal.currency,
          assigned_pm: profile.id,
          created_by: profile.id,
          status: "draft",
        })
        .select(`
          id, cspo_number, status, attendance_type, original_value, currency,
          planned_start, planned_end, created_at,
          vessel:vessels(id, name, fleet:fleets(id, name))
        `)
        .single();

      if (cspoErr) throw cspoErr;

      const { error: ledgerErr } = await supabase().from("cspo_value_ledger").insert({
        org_id: profile.org_id,
        cspo_id: cspo.id,
        entry_type: "initial",
        amount: proposal.total_value,
        currency: proposal.currency,
        performed_by: profile.id,
        notes: "CSPO activated from proposal",
      });

      if (ledgerErr) throw ledgerErr;

      await seedMaterialListFromProposal(cspo.id, input.proposalId, profile.org_id);

      const { error: convertErr } = await supabase()
        .from("proposals")
        .update({ status: "converted" })
        .eq("id", input.proposalId);

      if (convertErr) throw convertErr;

      const row = mapCspoInsertRow(cspo as unknown as Record<string, unknown>);
      return { id: row.id, row, proposalId: input.proposalId };
    },
    onSuccess: ({ row, proposalId }) => {
      patchDashboardAfterCspoCreated(qc, row.vessel?.id);
      patchReportsOverviewDelta(qc, "pnlCount", 1);
      patchCspoListAfterCreate(qc, row);
      patchCspoPnlReportPrepend(qc, buildCspoPnlRowFromCreate(row));
      patchProposalStatus(qc, proposalId, "converted");
    },
  });
}
