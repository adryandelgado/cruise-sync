import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";

export type DashboardStats = {
  openCspos: number;
  valueAtSea: number;
  vesselsUnderService: number;
  packingQueue: number;
  todaysDeliveries: number;
  procurementQueue: number;
};

export const DASHBOARD_STATS_QUERY_KEY = ["dashboard-stats"] as const;

type DashboardStatsRpc = {
  open_cspos: number;
  value_at_sea: number;
  vessels_under_service: number;
  packing_queue: number;
  todays_deliveries: number;
  procurement_queue: number;
};

function mapDashboardStats(payload: DashboardStatsRpc): DashboardStats {
  return {
    openCspos: Number(payload.open_cspos ?? 0),
    valueAtSea: Number(payload.value_at_sea ?? 0),
    vesselsUnderService: Number(payload.vessels_under_service ?? 0),
    packingQueue: Number(payload.packing_queue ?? 0),
    todaysDeliveries: Number(payload.todays_deliveries ?? 0),
    procurementQueue: Number(payload.procurement_queue ?? 0),
  };
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase().rpc("get_dashboard_stats");
  if (error) throw error;
  return mapDashboardStats((data ?? {}) as DashboardStatsRpc);
}

export function useDashboardStats() {
  return useQuery({
    queryKey: DASHBOARD_STATS_QUERY_KEY,
    enabled: env.supabaseConfigured,
    queryFn: fetchDashboardStats,
  });
}
