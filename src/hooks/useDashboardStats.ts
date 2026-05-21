import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard-stats"],
    enabled: env.supabaseConfigured,
    queryFn: async () => {
      const [csposRes, valueRes] = await Promise.all([
        supabase()
          .from("cruise_ship_pos")
          .select("id, status, vessel_id", { count: "exact" })
          .not("status", "in", "(closed,cancelled)"),
        supabase()
          .from("cspo_live_summary")
          .select("open_balance, status")
          .in("status", ["on_vessel", "in_progress", "closing"]),
      ]);

      const openCspos = csposRes.count ?? 0;
      const valueAtSea = (valueRes.data ?? []).reduce(
        (sum, r) => sum + Number(r.open_balance ?? 0),
        0,
      );
      const vesselsUnderService = new Set(
        (csposRes.data ?? []).map((r) => r.vessel_id),
      ).size;

      return { openCspos, valueAtSea, vesselsUnderService };
    },
  });
}
