import type { QueryClient } from "@tanstack/react-query";

export const MATERIAL_INSTANCES_QUERY_KEY = "material-instances" as const;

export type MaterialInstanceCacheRow = {
  id: string;
  status: string;
  serial_number: string | null;
  lot_number?: string | null;
  acquired_cost?: number | string | null;
  acquired_at?: string | null;
  notes?: string | null;
  created_at: string;
  sku: {
    id: string;
    sku_code: string;
    name: string;
    unit_of_measure: string;
  } | null;
  location: { name: string; code: string } | null;
  cspo: { cspo_number: string } | null;
};

export type MaterialInstancesCache = {
  instances: MaterialInstanceCacheRow[];
  totalCount: number;
  truncated: boolean;
};

export function materialInstancesQueryKey(status?: string) {
  return [MATERIAL_INSTANCES_QUERY_KEY, status ?? "all"] as const;
}

function patchMaterialInstancesQuery(
  qc: QueryClient,
  status: string | undefined,
  patch: (old: MaterialInstancesCache) => MaterialInstancesCache | undefined,
) {
  qc.setQueryData<MaterialInstancesCache>(materialInstancesQueryKey(status), (old) => {
    if (!old) return old;
    return patch(old) ?? old;
  });
}

export function patchMaterialInstancesAfterWarehouseReceive(
  qc: QueryClient,
  rows: MaterialInstanceCacheRow[],
) {
  if (rows.length === 0) return;

  const qty = rows.length;
  const patchReceive = (old: MaterialInstancesCache): MaterialInstancesCache => {
    const totalCount = old.totalCount + qty;
    if (old.truncated) {
      return { ...old, totalCount };
    }
    const instances = [...rows, ...old.instances].slice(0, old.instances.length + qty);
    return { instances, totalCount, truncated: totalCount > instances.length };
  };

  patchMaterialInstancesQuery(qc, undefined, patchReceive);
  patchMaterialInstancesQuery(qc, "in_stock", patchReceive);
}

export function patchMaterialInstancesAfterRestockReceive(
  qc: QueryClient,
  skuId: string,
  qty: number,
  toStatus = "in_stock",
) {
  if (qty <= 0) return;

  const transitionedRows: MaterialInstanceCacheRow[] = [];

  patchMaterialInstancesQuery(qc, undefined, (old) => {
    let remaining = qty;
    const instances = old.instances.map((inst) => {
      if (remaining > 0 && inst.sku?.id === skuId && inst.status === "returning") {
        remaining -= 1;
        const next: MaterialInstanceCacheRow = {
          ...inst,
          status: toStatus,
          cspo: toStatus === "in_stock" ? null : inst.cspo,
        };
        transitionedRows.push(next);
        return next;
      }
      return inst;
    });
    return { ...old, instances };
  });

  if (transitionedRows.length === 0) return;

  const removeIds = new Set(transitionedRows.map((row) => row.id));

  patchMaterialInstancesQuery(qc, "returning", (old) => ({
    ...old,
    instances: old.instances.filter((inst) => !removeIds.has(inst.id)),
    totalCount: Math.max(0, old.totalCount - transitionedRows.length),
  }));

  if (toStatus === "in_stock") {
    patchMaterialInstancesQuery(qc, "in_stock", (old) => {
      if (old.truncated) return old;
      const existingIds = new Set(old.instances.map((inst) => inst.id));
      const toAdd = transitionedRows.filter((inst) => !existingIds.has(inst.id));
      if (toAdd.length === 0) return old;
      return {
        ...old,
        instances: [...toAdd, ...old.instances],
        totalCount: old.totalCount + toAdd.length,
      };
    });
  }
}

export function mapProcurementInstancesToCache(
  rows: Array<{
    id: string;
    status: string;
    serial_number: string | null;
    lot_number?: string | null;
    acquired_cost?: number | string | null;
    acquired_at?: string | null;
    notes?: string | null;
    created_at: string;
    sku: {
      id: string;
      sku_code: string;
      name: string;
      unit_of_measure: string;
    } | null;
    location: { name: string; code: string } | null;
  }>,
): MaterialInstanceCacheRow[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    serial_number: row.serial_number,
    lot_number: row.lot_number ?? null,
    acquired_cost: row.acquired_cost,
    acquired_at: row.acquired_at ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    sku: row.sku,
    location: row.location,
    cspo: null,
  }));
}

export function buildWarehouseInstanceRows(
  inserted: Array<{
    id: string;
    status: string;
    serial_number: string | null;
    lot_number?: string | null;
    acquired_cost?: number | null;
    acquired_at?: string | null;
    notes?: string | null;
    created_at: string;
    sku_id: string;
  }>,
  sku: {
    id: string;
    sku_code: string;
    name: string;
    unit_of_measure: string;
  },
  location: { name: string; code: string } | null,
): MaterialInstanceCacheRow[] {
  return inserted.map((row) => ({
    id: row.id,
    status: row.status,
    serial_number: row.serial_number,
    lot_number: row.lot_number ?? null,
    acquired_cost: row.acquired_cost,
    acquired_at: row.acquired_at ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at,
    sku: {
      id: sku.id,
      sku_code: sku.sku_code,
      name: sku.name,
      unit_of_measure: sku.unit_of_measure,
    },
    location,
    cspo: null,
  }));
}
