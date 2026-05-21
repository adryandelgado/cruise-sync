import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

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

export function useCspos() {
  return useQuery({
    queryKey: ["cspos"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("cruise_ship_pos")
        .select(`
          id, cspo_number, status, attendance_type,
          original_value, currency, planned_start, planned_end, created_at,
          vessel:vessels(id, name, fleet:fleets(id, name))
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as CspoRow[];
    },
  });
}

export function useCspo(id: string) {
  return useQuery({
    queryKey: ["cspos", id],
    queryFn: async () => {
      const [detailRes, summaryRes] = await Promise.all([
        supabase()
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
          .single(),
        supabase()
          .from("cspo_live_summary")
          .select("*")
          .eq("cspo_id", id)
          .single(),
      ]);
      if (detailRes.error) throw detailRes.error;
      return { detail: detailRes.data, summary: summaryRes.data };
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
        .select("id")
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

      return cspo.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cspos"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
}
