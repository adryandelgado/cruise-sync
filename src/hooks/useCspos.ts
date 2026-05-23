import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  buildFinancialSummary,
  CSPO_FINANCIAL_QUERY_KEY,
  type CspoFinancialSummary,
  type LedgerEntryRow,
} from "@/lib/cspoFinancial";
import { supabase } from "@/lib/supabase";
import type { CspoWorkflowSummary } from "@/hooks/useClosure";
import { patchCspoStatus } from "@/lib/cspoDetailCache";
import { CSPO_LIST_QUERY_KEY, mapCspoInsertRow, patchCspoListAfterCreate } from "@/lib/cspoListCache";
import { patchDashboardAfterCspoCreated } from "@/lib/dashboardStatsCache";
import {
  buildCspoPnlRowFromCreate,
  patchCspoPnlReportPrepend,
  patchReportsOverviewDelta,
} from "@/lib/reportsCache";

export type CspoDetail = {
  id: string;
  cspo_number: string;
  status: string;
  attendance_type: string;
  port_of_service: string | null;
  original_value: number;
  currency: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  closure_notes: string | null;
  created_at: string;
  vessel: { id: string; name: string; fleet: { id: string; name: string } | null } | null;
  pm: { id: string; full_name: string; email: string } | null;
  bookkeeper: { id: string; full_name: string; email: string } | null;
};

export type CspoDetailSession = {
  cspo: CspoDetail;
  financial: {
    summary: CspoFinancialSummary;
    entries: LedgerEntryRow[];
  };
  workflow: CspoWorkflowSummary;
};

export const CSPO_DETAIL_SESSION_QUERY_KEY = "cspo-detail-session";

export type CspoRow = {
  id: string;
  cspo_number: string;
  status: string;
  attendance_type: string;
  original_value: number;
  currency: string;
  planned_start: string | null;
  planned_end: string | null;
  created_at: string;
  vessel: { id: string; name: string; fleet: { id: string; name: string } | null } | null;
};

export async function fetchCspos(): Promise<CspoRow[]> {
  const { data, error } = await supabase().rpc("list_cspos");
  if (error) throw error;
  return (data ?? []) as CspoRow[];
}

export function useCspos() {
  return useQuery({
    queryKey: CSPO_LIST_QUERY_KEY,
    queryFn: fetchCspos,
  });
}

export function useCspoFinancialSummary(cspoId: string) {
  return useQuery({
    queryKey: [CSPO_FINANCIAL_QUERY_KEY, cspoId],
    queryFn: async (): Promise<CspoDetailSession["financial"]> => {
      const { data, error } = await supabase().rpc("get_cspo_financial_summary", {
        p_cspo_id: cspoId,
      });
      if (error) throw error;

      const payload = data as {
        items_on_vessel: number;
        entries: LedgerEntryRow[];
      };

      const entries = payload.entries ?? [];
      return {
        summary: buildFinancialSummary(entries, payload.items_on_vessel ?? 0),
        entries,
      };
    },
  });
}

export async function fetchCspoDetailSession(cspoId: string): Promise<CspoDetailSession> {
  const { data, error } = await supabase().rpc("get_cspo_detail_session", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;

  type RpcPayload = {
    cspo: CspoDetail;
    financial: {
      items_on_vessel: number;
      entries: LedgerEntryRow[];
    };
    workflow: CspoWorkflowSummary;
  };

  const payload = data as RpcPayload;
  const entries = payload.financial.entries ?? [];
  return {
    cspo: payload.cspo,
    financial: {
      summary: buildFinancialSummary(entries, payload.financial.items_on_vessel ?? 0),
      entries,
    },
    workflow: payload.workflow,
  };
}

export function useCspoDetailSession(cspoId: string) {
  return useQuery({
    queryKey: [CSPO_DETAIL_SESSION_QUERY_KEY, cspoId],
    queryFn: () => fetchCspoDetailSession(cspoId),
  });
}

export function useCspo(id: string) {
  return useQuery({
    queryKey: ["cspos", id],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("cruise_ship_pos")
        .select(`
          id, cspo_number, status, attendance_type, port_of_service,
          original_value, currency, planned_start, planned_end,
          actual_start, actual_end, closure_notes, created_at,
          vessel:vessels(id, name, fleet:fleets(id, name)),
          pm:profiles!assigned_pm(id, full_name, email),
          bookkeeper:profiles!assigned_bookkeeper(id, full_name, email)
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return { detail: data };
    },
  });
}

export type CreateCspoInput = {
  cspo_number: string;
  vessel_id: string;
  attendance_type: "in_service" | "in_drydock";
  port_of_service?: string;
  planned_start?: string;
  planned_end?: string;
  original_value: number;
  currency: string;
};

export function useCreateCspo() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCspoInput) => {
      if (!profile) throw new Error("Not authenticated");

      // 1. Insert the CSPO row.
      const { data: cspo, error: cspoErr } = await supabase()
        .from("cruise_ship_pos")
        .insert({
          org_id: profile.org_id,
          cspo_number: input.cspo_number,
          vessel_id: input.vessel_id,
          attendance_type: input.attendance_type,
          port_of_service: input.port_of_service ?? null,
          planned_start: input.planned_start ?? null,
          planned_end: input.planned_end ?? null,
          original_value: input.original_value,
          currency: input.currency,
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

      // 2. Seed the value ledger with the initial amount.
      const { error: ledgerErr } = await supabase()
        .from("cspo_value_ledger")
        .insert({
          org_id: profile.org_id,
          cspo_id: cspo.id,
          entry_type: "initial",
          amount: input.original_value,
          currency: input.currency,
          performed_by: profile.id,
          notes: "CSPO created",
        });

      if (ledgerErr) throw ledgerErr;

      // 3. Create an empty draft material list for the PM to fill in.
      const { error: listErr } = await supabase()
        .from("material_lists")
        .insert({ org_id: profile.org_id, cspo_id: cspo.id });

      if (listErr) throw listErr;

      const row = mapCspoInsertRow(cspo as unknown as Record<string, unknown>);
      return { id: row.id, row };
    },
    onSuccess: ({ row }) => {
      patchDashboardAfterCspoCreated(qc, row.vessel?.id);
      patchReportsOverviewDelta(qc, "pnlCount", 1);
      patchCspoListAfterCreate(qc, row);
      patchCspoPnlReportPrepend(qc, buildCspoPnlRowFromCreate(row));
    },
  });
}

export function useActivateCspo() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (cspoId: string) => {
      const today = new Date().toISOString().slice(0, 10);

      const { error } = await supabase()
        .from("cruise_ship_pos")
        .update({ status: "active", actual_start: today })
        .eq("id", cspoId)
        .eq("status", "draft");

      if (error) throw error;
    },
    onSuccess: (_data, cspoId) => {
      patchCspoStatus(qc, cspoId, "active", {
        actual_start: new Date().toISOString().slice(0, 10),
      });
    },
  });
}
