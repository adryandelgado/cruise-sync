type ProcurementRequestFilterFields = {
  status: string;
  sku: { sku_code: string; name: string } | null;
  cspo: { cspo_number: string } | null;
};

export const PROCUREMENT_STATUS_FILTERS = [
  { id: "", label: "All open" },
  { id: "open", label: "Open" },
  { id: "partial", label: "Partial" },
  { id: "ordered", label: "Ordered" },
] as const;

export function filterProcurementRequests<T extends ProcurementRequestFilterFields>(
  requests: T[],
  search: string,
  statusFilter: string,
): T[] {
  const q = search.trim().toUpperCase();
  return requests.filter((req) => {
    if (statusFilter && req.status !== statusFilter) return false;
    if (!q) return true;
    const sku = req.sku?.sku_code?.toUpperCase() ?? "";
    const name = req.sku?.name?.toUpperCase() ?? "";
    const cspo = req.cspo?.cspo_number?.toUpperCase() ?? "";
    return sku.includes(q) || name.includes(q) || cspo.includes(q);
  });
}
