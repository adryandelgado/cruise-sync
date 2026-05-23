import {
  patchCspoDetailAfterReceive,
  patchCspoDetailFromAboardInventory,
} from "@/lib/cspoDetailCache";
import {
  patchDashboardAfterAllPackagesReceived,
  patchDashboardValueAtSeaAfterAboard,
} from "@/lib/dashboardStatsCache";
import {
  patchOnboardHubAfterReceive,
  patchOnboardHubInventoryTotals,
} from "@/lib/onboardHubCache";
import type { QueryClient } from "@tanstack/react-query";
import type {
  OnboardSkuInventoryRow,
  ReceiveSession,
  ReturnManifestRow,
  ReturnsSession,
  UsageLogRow,
  UsageLogSession,
} from "@/hooks/useOnboard";

function patchInventoryRows(
  qc: QueryClient,
  cspoId: string,
  updater: (rows: OnboardSkuInventoryRow[]) => OnboardSkuInventoryRow[],
) {
  qc.setQueryData<OnboardSkuInventoryRow[]>(["onboard-sku-inventory", cspoId], (old) => {
    if (!old) return old;
    return updater(old);
  });
  qc.setQueryData<UsageLogSession>(["usage-log-session", cspoId], (old) => {
    if (!old) return old;
    return { ...old, inventory: updater(old.inventory) };
  });
  qc.setQueryData<ReturnsSession>(["returns-session", cspoId], (old) => {
    if (!old) return old;
    return { ...old, inventory: updater(old.inventory) };
  });
}

function patchReturnManifestData(
  qc: QueryClient,
  cspoId: string,
  updater: (manifest: ReturnManifestRow | null | undefined) => ReturnManifestRow | null,
) {
  qc.setQueryData<ReturnManifestRow | null>(["return-manifest", cspoId], (old) =>
    updater(old),
  );
  qc.setQueryData<ReturnsSession>(["returns-session", cspoId], (old) => {
    if (!old) return old;
    return { ...old, manifest: updater(old.manifest) };
  });
}

export function patchOnboardInventoryAfterReceive(
  qc: QueryClient,
  cspoId: string,
  deltas: Array<{
    sku_id: string;
    sku_code: string;
    name: string;
    unit_of_measure: string;
    qty_added: number;
  }>,
) {
  if (deltas.length === 0) return;

  patchInventoryRows(qc, cspoId, (old) => {
    const rows = [...old];
    for (const delta of deltas) {
      const idx = rows.findIndex((row) => row.sku_id === delta.sku_id);
      if (idx >= 0) {
        const row = rows[idx];
        rows[idx] = {
          ...row,
          aboard: row.aboard + delta.qty_added,
          available: row.available + delta.qty_added,
        };
      } else {
        rows.push({
          sku_id: delta.sku_id,
          sku_code: delta.sku_code,
          name: delta.name,
          unit_of_measure: delta.unit_of_measure,
          aboard: delta.qty_added,
          on_manifest: 0,
          available: delta.qty_added,
        });
      }
    }
    return rows;
  });
  patchCspoWorkflowSummaryFromInventory(qc, cspoId);
}

export function patchOnboardInventoryAfterSeal(
  qc: QueryClient,
  cspoId: string,
  manifestItems: ReturnManifestRow["items"],
) {
  const bySku = new Map<string, { sku_code: string; name: string; qty: number }>();
  for (const item of manifestItems) {
    const sku = item.material_instance?.sku;
    if (!sku) continue;
    const prev = bySku.get(sku.sku_code);
    bySku.set(sku.sku_code, {
      sku_code: sku.sku_code,
      name: sku.name,
      qty: (prev?.qty ?? 0) + 1,
    });
  }
  if (bySku.size === 0) return;

  patchInventoryRows(qc, cspoId, (old) =>
    old
      .map((row) => {
        const dec = bySku.get(row.sku_code);
        if (!dec) return row;
        const aboard = Math.max(0, row.aboard - dec.qty);
        const on_manifest = Math.max(0, row.on_manifest - dec.qty);
        return {
          ...row,
          aboard,
          on_manifest,
          available: Math.max(0, aboard - on_manifest),
        };
      })
      .filter((row) => row.aboard > 0),
  );
  patchCspoWorkflowSummaryFromInventory(qc, cspoId);
}

export function patchReceiveSessionAfterReceive(
  qc: QueryClient,
  cspoId: string,
  packageId: string,
) {
  let nextSession: ReceiveSession | undefined;
  let leftInTransit = false;

  qc.setQueryData<ReceiveSession>(["receive-session", cspoId], (old) => {
    if (!old) return old;

    const now = new Date().toISOString();
    let trackableAdded = 0;

    const packages = old.packages.map((pkg) => {
      if (pkg.id !== packageId) return pkg;
      if (pkg.received) return pkg;
      trackableAdded = pkg.trackable_count;
      return {
        ...pkg,
        received: true,
        status: "delivered",
        receipt: {
          received_at: now,
          discrepancy_notes: null,
        },
      };
    });

    const allReceived = packages.length > 0 && packages.every((p) => p.received);
    const items_on_vessel = old.items_on_vessel + trackableAdded;

    let cspoStatus = old.cspo.status;
    if (allReceived) {
      cspoStatus = items_on_vessel > 0 ? "on_vessel" : "in_progress";
      leftInTransit = old.cspo.status === "in_transit";
    }

    nextSession = {
      ...old,
      cspo: { ...old.cspo, status: cspoStatus },
      packages,
      items_on_vessel,
    };
    return nextSession;
  });

  if (nextSession) {
    patchCspoDetailAfterReceive(qc, cspoId, nextSession);
    patchOnboardHubAfterReceive(qc, cspoId, nextSession);
    if (leftInTransit) {
      patchDashboardAfterAllPackagesReceived(qc);
      patchDashboardValueAtSeaAfterAboard(qc, cspoId);
    }
  }
}

export function patchOnboardSkuAfterTransferAck(
  qc: QueryClient,
  cspoId: string,
  sku: {
    sku_id: string;
    sku_code: string;
    name: string;
    unit_of_measure: string;
  },
  remainingOnVessel?: number,
) {
  patchInventoryRows(qc, cspoId, (old) => {
    const existing = old.find((row) => row.sku_id === sku.sku_id);
    if (existing) {
      const aboard = remainingOnVessel ?? existing.aboard + 1;
      return old.map((row) =>
        row.sku_id === sku.sku_id
          ? {
              ...row,
              aboard,
              available: Math.max(0, aboard - row.on_manifest),
            }
          : row,
      );
    }

    const aboard = remainingOnVessel ?? 1;
    return [
      ...old,
      {
        sku_id: sku.sku_id,
        sku_code: sku.sku_code,
        name: sku.name,
        unit_of_measure: sku.unit_of_measure,
        aboard,
        on_manifest: 0,
        available: aboard,
      },
    ];
  });
  patchCspoWorkflowSummaryFromInventory(qc, cspoId);
}

export function patchOnboardSkuAfterUsage(
  qc: QueryClient,
  cspoId: string,
  skuId: string,
  remainingOnVessel: number,
) {
  patchInventoryRows(qc, cspoId, (old) =>
    old
      .map((row) => {
        if (row.sku_id !== skuId) return row;
        return {
          ...row,
          aboard: remainingOnVessel,
          available: Math.max(0, remainingOnVessel - row.on_manifest),
        };
      })
      .filter((row) => row.aboard > 0),
  );
}

export function patchOnboardSkuAfterReturnAdd(
  qc: QueryClient,
  cspoId: string,
  skuId: string,
  onManifest: number,
) {
  patchInventoryRows(qc, cspoId, (old) =>
    old.map((row) => {
      if (row.sku_id !== skuId) return row;
      return {
        ...row,
        on_manifest: onManifest,
        available: Math.max(0, row.aboard - onManifest),
      };
    }),
  );
}

export function patchUsageLogsAfterSkuLog(
  qc: QueryClient,
  cspoId: string,
  entry: {
    skuCode: string;
    skuName: string;
    actionType: string;
    qty: number;
    notes?: string | null;
    location?: string | null;
  },
  logId?: string,
) {
  const logEntry: UsageLogRow = {
    id: logId ?? `optimistic-${crypto.randomUUID()}`,
    action_type: entry.actionType,
    logged_at: new Date().toISOString(),
    notes: entry.notes ?? null,
    location_on_vessel: entry.location ?? null,
    qty: entry.qty,
    material_instance: {
      sku: { sku_code: entry.skuCode, name: entry.skuName },
    },
  };

  qc.setQueryData<UsageLogRow[]>(["usage-logs", cspoId], (old) =>
    [logEntry, ...(old ?? [])].slice(0, 100),
  );
  qc.setQueryData<UsageLogSession>(["usage-log-session", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      usage_logs: [logEntry, ...old.usage_logs].slice(0, 100),
    };
  });
}

export function removeUsageLogById(qc: QueryClient, cspoId: string, logId: string) {
  qc.setQueryData<UsageLogRow[]>(["usage-logs", cspoId], (old) =>
    (old ?? []).filter((row) => row.id !== logId),
  );
  qc.setQueryData<UsageLogSession>(["usage-log-session", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      usage_logs: old.usage_logs.filter((row) => row.id !== logId),
    };
  });
}

export function patchCspoWorkflowSummaryFromInventory(qc: QueryClient, cspoId: string) {
  const inventory =
    qc.getQueryData<OnboardSkuInventoryRow[]>(["onboard-sku-inventory", cspoId]) ??
    qc.getQueryData<UsageLogSession>(["usage-log-session", cspoId])?.inventory ??
    qc.getQueryData<ReturnsSession>(["returns-session", cspoId])?.inventory;
  if (!inventory) return;

  const units_aboard = inventory.reduce((sum, row) => sum + row.aboard, 0);
  const sku_count_aboard = inventory.filter((row) => row.aboard > 0).length;

  patchCspoDetailFromAboardInventory(qc, cspoId, units_aboard, sku_count_aboard);
  patchOnboardHubInventoryTotals(qc, cspoId, units_aboard);
}

export function removeOptimisticReturnManifestItems(
  qc: QueryClient,
  cspoId: string,
  manifestId: string,
) {
  patchReturnManifestData(qc, cspoId, (old) => {
    if (!old || old.id !== manifestId) return old ?? null;
    return {
      ...old,
      items: old.items.filter((item) => !item.id.startsWith("optimistic-")),
    };
  });
}

export type ReturnManifestCache = ReturnManifestRow;

export function patchReturnManifestCreate(
  qc: QueryClient,
  cspoId: string,
  manifestId: string,
) {
  patchReturnManifestData(qc, cspoId, () => ({
    id: manifestId,
    status: "draft",
    freight_company: null,
    created_at: new Date().toISOString(),
    items: [],
  }));
}

export function patchReturnManifestAfterAdd(
  qc: QueryClient,
  cspoId: string,
  manifestId: string,
  skuCode: string,
  skuName: string,
  added: number,
  condition = "good",
) {
  if (added <= 0) return;

  const newItems = Array.from({ length: added }, () => ({
    id: `optimistic-${crypto.randomUUID()}`,
    condition,
    material_instance: {
      sku: { sku_code: skuCode, name: skuName },
    },
  }));

  patchReturnManifestData(qc, cspoId, (old) => {
    if (!old) {
      return {
        id: manifestId,
        status: "draft",
        freight_company: null,
        created_at: new Date().toISOString(),
        items: newItems,
      };
    }
    return { ...old, items: [...old.items, ...newItems] };
  });
}

export function patchReturnManifestAfterAddInstance(
  qc: QueryClient,
  cspoId: string,
  manifestId: string,
  item: {
    instanceId: string;
    skuCode: string;
    skuName: string;
    condition?: string;
  },
) {
  const newItem = {
    id: `optimistic-${crypto.randomUUID()}`,
    condition: item.condition ?? "good",
    material_instance: {
      id: item.instanceId,
      sku: { sku_code: item.skuCode, name: item.skuName },
    },
  };

  patchReturnManifestData(qc, cspoId, (old) => {
    if (!old) {
      return {
        id: manifestId,
        status: "draft",
        freight_company: null,
        created_at: new Date().toISOString(),
        items: [newItem],
      };
    }
    return { ...old, items: [...old.items, newItem] };
  });
}

export function patchReturnManifestAfterSeal(qc: QueryClient, cspoId: string) {
  patchReturnManifestData(qc, cspoId, () => null);
}

export function replaceReturnManifestId(
  qc: QueryClient,
  cspoId: string,
  fromId: string,
  toId: string,
) {
  patchReturnManifestData(qc, cspoId, (old) => {
    if (!old || old.id !== fromId) return old ?? null;
    return { ...old, id: toId };
  });
}
