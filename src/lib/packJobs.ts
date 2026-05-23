export const PACK_QUEUE_LIST_STATUSES = [
  "submitted",
  "in_packing",
  "partially_packed",
  "awaiting_procurement",
] as const;

/** CSPOs still in the warehouse packing phase (exclude shipped / aboard). */
export const WAREHOUSE_CSPO_STATUSES = ["active", "packing"] as const;

type ListItemQty = { requested_qty: number; packed_qty: number };

export function computeListProgress(items: ListItemQty[]) {
  let totalUnits = 0;
  let packedUnits = 0;
  let completeLines = 0;

  for (const item of items) {
    const req = Number(item.requested_qty);
    const packed = Number(item.packed_qty);
    totalUnits += req;
    packedUnits += Math.min(packed, req);
    if (packed >= req) completeLines += 1;
  }

  return {
    itemCount: items.length,
    completeLines,
    totalUnits,
    packedUnits,
    remainingUnits: totalUnits - packedUnits,
    isFullyPacked: items.length > 0 && totalUnits > 0 && packedUnits >= totalUnits,
  };
}

export function isWarehousePackCspo(status: string) {
  return (WAREHOUSE_CSPO_STATUSES as readonly string[]).includes(status);
}
