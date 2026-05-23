import type { QueryClient } from "@tanstack/react-query";
import type { PackJobRow } from "@/hooks/usePackJobs";
import type { MaterialListRow } from "@/hooks/useMaterialList";
import type { CspoRow } from "@/hooks/useCspos";
import { CSPO_LIST_QUERY_KEY } from "@/lib/cspoListCache";

export const WAREHOUSE_HUB_QUERY_KEY = ["warehouse-hub"] as const;

export type WarehouseRestockSummary = {
  manifestCount: number;
  pendingUnits: number;
};

export type WarehouseHub = {
  packJobs: PackJobRow[];
  restock: WarehouseRestockSummary;
};

type PackJobRpcRow = {
  cspo_id: string;
  cspo_number: string;
  status: string;
  attendance_type: string;
  planned_end: string | null;
  vessel: PackJobRow["vessel"];
  material_list: NonNullable<PackJobRow["material_list"]>;
};

export type WarehouseHubRpc = {
  pack_jobs: PackJobRpcRow[];
  restock: {
    manifest_count: number;
    pending_units: number;
  };
};

export function mapPackJobsFromRpc(rows: PackJobRpcRow[]): PackJobRow[] {
  return rows.map((row) => ({
    cspo_id: row.cspo_id,
    cspo_number: row.cspo_number,
    status: row.status,
    attendance_type: row.attendance_type,
    planned_end: row.planned_end,
    vessel: row.vessel,
    material_list: {
      id: row.material_list.id,
      status: row.material_list.status,
      item_count: Number(row.material_list.item_count),
      packed_count: Number(row.material_list.packed_count),
      total_units: Number(row.material_list.total_units),
      packed_units: Number(row.material_list.packed_units),
      remaining_units: Number(row.material_list.remaining_units),
      is_fully_packed: Boolean(row.material_list.is_fully_packed),
    },
  }));
}

export function mapWarehouseHubFromRpc(payload: WarehouseHubRpc): WarehouseHub {
  return {
    packJobs: mapPackJobsFromRpc(payload.pack_jobs ?? []),
    restock: {
      manifestCount: Number(payload.restock?.manifest_count ?? 0),
      pendingUnits: Number(payload.restock?.pending_units ?? 0),
    },
  };
}

export function patchWarehouseHubAfterRestockReceive(
  qc: QueryClient,
  received: number,
) {
  if (received <= 0) return;

  qc.setQueryData<WarehouseHub>(WAREHOUSE_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    return {
      ...old,
      restock: {
        ...old.restock,
        pendingUnits: Math.max(0, old.restock.pendingUnits - received),
      },
    };
  });
}

export function patchWarehouseHubAfterRestockComplete(
  qc: QueryClient,
  pendingUnits: number,
) {
  qc.setQueryData<WarehouseHub>(WAREHOUSE_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    return {
      ...old,
      restock: {
        manifestCount: Math.max(0, old.restock.manifestCount - 1),
        pendingUnits: Math.max(0, old.restock.pendingUnits - pendingUnits),
      },
    };
  });
}

export function patchWarehouseHubRemovePackJob(qc: QueryClient, cspoId: string) {
  qc.setQueryData<WarehouseHub>(WAREHOUSE_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    return {
      ...old,
      packJobs: old.packJobs.filter((job) => job.cspo_id !== cspoId),
    };
  });
}

type PackListSnapshot = {
  status: string;
  items: Array<{ requested_qty: number; packed_qty: number }>;
};

function packJobStatsFromList(list: PackListSnapshot) {
  const itemCount = list.items.length;
  let packedUnits = 0;
  let totalUnits = 0;
  let packedCount = 0;

  for (const item of list.items) {
    const requested = Number(item.requested_qty);
    const packed = Number(item.packed_qty);
    totalUnits += requested;
    packedUnits += Math.min(packed, requested);
    if (packed >= requested) packedCount += 1;
  }

  const remainingUnits = Math.max(0, totalUnits - packedUnits);
  const isFullyPacked = itemCount > 0 && packedCount === itemCount;

  return {
    item_count: itemCount,
    packed_count: packedCount,
    total_units: totalUnits,
    packed_units: packedUnits,
    remaining_units: remainingUnits,
    is_fully_packed: isFullyPacked,
    status: list.status,
  };
}

/** Sync warehouse job card progress after pack session changes. */
export function patchWarehouseHubFromPackList(
  qc: QueryClient,
  cspoId: string,
  list: PackListSnapshot,
) {
  const stats = packJobStatsFromList(list);

  qc.setQueryData<WarehouseHub>(WAREHOUSE_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    const hasJob = old.packJobs.some((job) => job.cspo_id === cspoId);
    if (!hasJob) return old;

    const packJobs = old.packJobs.map((job) => {
      if (job.cspo_id !== cspoId || !job.material_list) return job;
      return {
        ...job,
        material_list: {
          ...job.material_list,
          status: stats.status,
          item_count: stats.item_count,
          packed_count: stats.packed_count,
          total_units: stats.total_units,
          packed_units: stats.packed_units,
          remaining_units: stats.remaining_units,
          is_fully_packed: stats.is_fully_packed,
        },
      };
    });

    return { ...old, packJobs };
  });
}

const WAREHOUSE_LIST_STATUSES = new Set([
  "submitted",
  "in_packing",
  "partially_packed",
  "awaiting_procurement",
]);

function materialListJobStats(items: MaterialListRow["items"]) {
  let totalUnits = 0;
  let packedUnits = 0;
  let packedCount = 0;

  for (const item of items) {
    const requested = Number(item.requested_qty);
    const packed = Number(item.packed_qty);
    totalUnits += requested;
    packedUnits += Math.min(packed, requested);
    if (requested > 0 && packed >= requested) packedCount += 1;
  }

  return {
    item_count: items.length,
    packed_count: packedCount,
    total_units: totalUnits,
    packed_units: packedUnits,
    remaining_units: Math.max(0, totalUnits - packedUnits),
    is_fully_packed: items.length > 0 && packedCount === items.length,
  };
}

/** Sync warehouse pack job card from material-list cache. */
export function patchWarehouseHubFromMaterialList(qc: QueryClient, cspoId: string) {
  const list = qc.getQueryData<MaterialListRow | null>(["material-list", cspoId]);
  if (!list || !WAREHOUSE_LIST_STATUSES.has(list.status)) return;

  const cspo = qc.getQueryData<CspoRow[]>(CSPO_LIST_QUERY_KEY)?.find((row) => row.id === cspoId);
  if (!cspo) return;

  const stats = materialListJobStats(list.items);

  qc.setQueryData<WarehouseHub>(WAREHOUSE_HUB_QUERY_KEY, (old) => {
    if (!old) return old;

    const existing = old.packJobs.some((job) => job.cspo_id === cspoId);
    if (existing) {
      return {
        ...old,
        packJobs: old.packJobs.map((job) => {
          if (job.cspo_id !== cspoId || !job.material_list) return job;
          return {
            ...job,
            status: cspo.status,
            material_list: {
              ...job.material_list,
              id: list.id,
              status: list.status,
              ...stats,
            },
          };
        }),
      };
    }

    const job: PackJobRow = {
      cspo_id: cspoId,
      cspo_number: cspo.cspo_number,
      status: cspo.status,
      attendance_type: cspo.attendance_type,
      planned_end: cspo.planned_end,
      vessel: cspo.vessel
        ? {
            id: cspo.vessel.id,
            name: cspo.vessel.name,
            fleet: cspo.vessel.fleet ? { name: cspo.vessel.fleet.name } : null,
          }
        : null,
      material_list: {
        id: list.id,
        status: list.status,
        ...stats,
      },
    };

    return { ...old, packJobs: [job, ...old.packJobs] };
  });
}

export function patchWarehouseHubAfterRestockManifestSealed(
  qc: QueryClient,
  pendingUnits: number,
) {
  if (pendingUnits <= 0) return;

  qc.setQueryData<WarehouseHub>(WAREHOUSE_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    return {
      ...old,
      restock: {
        manifestCount: old.restock.manifestCount + 1,
        pendingUnits: old.restock.pendingUnits + pendingUnits,
      },
    };
  });
}
