import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const REPORTS_OVERVIEW_QUERY_KEY = ["reports-overview"] as const;
export const CSPO_PNL_REPORT_QUERY_KEY = ["cspo-pnl-report"] as const;
export const TRANSFER_AUDIT_QUERY_KEY = ["transfer-audit"] as const;
export const VESSEL_SPEND_REPORT_QUERY_KEY = ["report-vessel-spend"] as const;
export const FLEET_COMPARISON_REPORT_QUERY_KEY = ["report-fleet-comparison"] as const;
export const SKU_CONSUMPTION_REPORT_QUERY_KEY = ["report-sku-consumption"] as const;
export const PROCUREMENT_LAG_REPORT_QUERY_KEY = ["report-procurement-lag"] as const;
export const BOOKKEEPER_REPORT_QUERY_KEY = ["report-bookkeeper"] as const;
export const AUDIT_EVENTS_QUERY_KEY = ["audit-events"] as const;
export const REPORT_STALE_MS = 120_000;

export type ReportsOverview = {
  pnlCount: number;
  transferCount: number;
  vesselCount: number;
  fleetCount: number;
  skuCount: number;
  procurementLagCount: number;
  bookkeeperCount: number;
  auditCount: number;
};

export type CspoPnlReportRow = {
  cspo_id: string;
  cspo_number: string;
  status: string;
  original_value: number | string;
  consumed_value: number | string;
  installed_value: number | string;
  returned_value: number | string;
  transferred_out_value: number | string;
  open_balance: number | string;
  variance_pct: number | string;
  currency: string;
};

export type TransferAuditRow = {
  transfer_id: string;
  initiated_at: string;
  sku_code: string;
  sku_name: string;
  from_cspo: string;
  to_cspo: string;
  transferred_value: number | string;
  currency: string;
  acknowledged_at: string | null;
};

export type VesselSpendRow = {
  vessel_id: string;
  vessel_name: string;
  fleet_name: string | null;
  cspo_count: number | string;
  total_issued_value: number | string;
  total_consumed_value: number | string;
  total_open_balance: number | string;
};

export type FleetComparisonRow = {
  fleet_id: string;
  fleet_name: string;
  vessel_count: number | string;
  cspo_count: number | string;
  avg_closed_job_value: number | string;
  avg_variance_pct: number | string;
  avg_return_rate_pct: number | string;
  transfer_count: number | string;
};

export type SkuConsumptionRow = {
  sku_id: string;
  sku_code: string;
  sku_name: string;
  category: string | null;
  qty_consumed: number | string;
  qty_installed: number | string;
  return_count: number | string;
};

export type ProcurementLagRow = {
  request_id: string;
  sku_code: string;
  sku_name: string;
  cspo_number: string | null;
  status: string;
  lag_days: number | null;
};

export type AuditEventRow = {
  id: string;
  table_name: string;
  record_id?: string;
  action: string;
  occurred_at: string;
  actor_id?: string | null;
};

export type MaterialInstanceSearchRow = {
  id: string;
  status: string;
  serial_number: string | null;
  sku: { sku_code: string; name: string } | null;
};

export type MaterialTraceRow = {
  movement_id: string;
  material_instance_id: string;
  sku_code: string;
  sku_name: string;
  from_status: string | null;
  to_status: string | null;
  cspo_id: string | null;
  cspo_number: string | null;
  reason_code: string | null;
  notes: string | null;
  occurred_at: string;
};

function asJsonArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

type ReportsOverviewRpc = {
  pnl_count: number;
  transfer_count: number;
  vessel_count: number;
  fleet_count: number;
  sku_count: number;
  procurement_lag_count: number;
  bookkeeper_count: number;
  audit_count: number;
};

export function mapReportsOverview(payload: ReportsOverviewRpc): ReportsOverview {
  return {
    pnlCount: Number(payload.pnl_count ?? 0),
    transferCount: Number(payload.transfer_count ?? 0),
    vesselCount: Number(payload.vessel_count ?? 0),
    fleetCount: Number(payload.fleet_count ?? 0),
    skuCount: Number(payload.sku_count ?? 0),
    procurementLagCount: Number(payload.procurement_lag_count ?? 0),
    bookkeeperCount: Number(payload.bookkeeper_count ?? 0),
    auditCount: Number(payload.audit_count ?? 0),
  };
}

export async function fetchReportsOverview(): Promise<ReportsOverview> {
  const { data, error } = await supabase().rpc("get_reports_overview");
  if (error) throw error;
  return mapReportsOverview((data ?? {}) as ReportsOverviewRpc);
}

export function useReportsOverview() {
  return useQuery({
    queryKey: REPORTS_OVERVIEW_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchReportsOverview,
  });
}

export async function fetchVesselSpendReport(): Promise<VesselSpendRow[]> {
  const { data, error } = await supabase().rpc("list_vessel_spend_report");
  if (error) throw error;
  return asJsonArray<VesselSpendRow>(data);
}

export function useVesselSpendReport() {
  return useQuery({
    queryKey: VESSEL_SPEND_REPORT_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchVesselSpendReport,
  });
}

export async function fetchFleetComparisonReport(): Promise<FleetComparisonRow[]> {
  const { data, error } = await supabase().rpc("list_fleet_comparison_report");
  if (error) throw error;
  return asJsonArray<FleetComparisonRow>(data);
}

export function useFleetComparisonReport() {
  return useQuery({
    queryKey: FLEET_COMPARISON_REPORT_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchFleetComparisonReport,
  });
}

export async function fetchSkuConsumptionReport(): Promise<SkuConsumptionRow[]> {
  const { data, error } = await supabase().rpc("list_sku_consumption_report");
  if (error) throw error;
  return asJsonArray<SkuConsumptionRow>(data);
}

export function useSkuConsumptionReport() {
  return useQuery({
    queryKey: SKU_CONSUMPTION_REPORT_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchSkuConsumptionReport,
  });
}

export async function fetchProcurementLagReport(): Promise<ProcurementLagRow[]> {
  const { data, error } = await supabase().rpc("list_procurement_lag_report", {
    p_limit: 50,
  });
  if (error) throw error;
  return asJsonArray<ProcurementLagRow>(data);
}

export function useProcurementLagReport() {
  return useQuery({
    queryKey: PROCUREMENT_LAG_REPORT_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchProcurementLagReport,
  });
}

export type BookkeeperPerformanceRow = {
  bookkeeper_id: string;
  full_name: string;
  email: string;
  cspo_count: number;
  closed_count: number;
  avg_variance_pct: number;
  total_open_balance: number;
};

export async function fetchBookkeeperPerformanceReport(): Promise<BookkeeperPerformanceRow[]> {
  const { data, error } = await supabase().rpc("get_bookkeeper_performance_report");
  if (error) throw error;
  return ((data ?? []) as BookkeeperPerformanceRow[]).map((row) => ({
    ...row,
    cspo_count: Number(row.cspo_count ?? 0),
    closed_count: Number(row.closed_count ?? 0),
    avg_variance_pct: Number(row.avg_variance_pct ?? 0),
    total_open_balance: Number(row.total_open_balance ?? 0),
  }));
}

export function useBookkeeperPerformanceReport() {
  return useQuery({
    queryKey: BOOKKEEPER_REPORT_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchBookkeeperPerformanceReport,
  });
}

export async function fetchCspoPnlReport(): Promise<CspoPnlReportRow[]> {
  const { data, error } = await supabase().rpc("list_cspo_pnl_report");
  if (error) throw error;
  return asJsonArray<CspoPnlReportRow>(data);
}

export function useCspoPnlReport() {
  return useQuery({
    queryKey: CSPO_PNL_REPORT_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchCspoPnlReport,
  });
}

export async function fetchTransferAudit(): Promise<TransferAuditRow[]> {
  const { data, error } = await supabase().rpc("list_transfer_audit", {
    p_limit: 100,
  });
  if (error) throw error;
  return asJsonArray<TransferAuditRow>(data);
}

export function useTransferAudit() {
  return useQuery({
    queryKey: TRANSFER_AUDIT_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchTransferAudit,
  });
}

export async function fetchAuditEvents(): Promise<AuditEventRow[]> {
  const { data, error } = await supabase().rpc("list_audit_events", {
    p_limit: 50,
  });
  if (error) throw error;
  return asJsonArray<AuditEventRow>(data);
}

export function useAuditEvents() {
  return useQuery({
    queryKey: AUDIT_EVENTS_QUERY_KEY,
    staleTime: REPORT_STALE_MS,
    queryFn: fetchAuditEvents,
  });
}

export function materialTraceQueryKey(instanceId: string) {
  return ["material-trace", instanceId] as const;
}

export async function fetchMaterialTrace(instanceId: string): Promise<MaterialTraceRow[]> {
  const { data, error } = await supabase().rpc("get_material_trace", {
    p_material_instance_id: instanceId,
  });
  if (error) throw error;
  return asJsonArray<MaterialTraceRow>(data);
}

export function useMaterialTrace(instanceId: string) {
  return useQuery({
    queryKey: materialTraceQueryKey(instanceId),
    enabled: !!instanceId,
    staleTime: REPORT_STALE_MS,
    queryFn: () => fetchMaterialTrace(instanceId),
  });
}

export function materialInstanceSearchQueryKey(query: string) {
  return ["material-search", query] as const;
}

export async function fetchMaterialInstanceSearch(
  query: string,
): Promise<MaterialInstanceSearchRow[]> {
  const { data, error } = await supabase().rpc("search_material_instances", {
    p_query: query.trim(),
    p_limit: 20,
  });
  if (error) throw error;
  return asJsonArray<MaterialInstanceSearchRow>(data);
}

export function useMaterialInstanceSearch(query: string) {
  return useQuery({
    queryKey: materialInstanceSearchQueryKey(query),
    enabled: query.length >= 2,
    queryFn: () => fetchMaterialInstanceSearch(query),
  });
}

export function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(val: string) {
  if (val.includes(",") || val.includes('"')) return `"${val.replace(/"/g, '""')}"`;
  return val;
}
