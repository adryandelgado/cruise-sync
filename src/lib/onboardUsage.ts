export type OnboardInstance = {
  id: string;
  sku_id: string | null;
  status: string;
  serial_number: string | null;
  sku: {
    sku_code: string;
    name: string;
    unit_of_measure: string;
  } | null;
};

export type OnboardSkuRow = {
  sku_id: string;
  sku_code: string;
  name: string;
  unit_of_measure: string;
  on_vessel: number;
  on_manifest?: number;
  available?: number;
};

export type UsageLogEntry = {
  id: string;
  action_type: string;
  logged_at: string;
  notes: string | null;
  location_on_vessel: string | null;
  qty: number;
  material_instance: {
    sku: { sku_code: string; name: string } | null;
  } | null;
};

export function groupOnboardBySku(instances: OnboardInstance[]): OnboardSkuRow[] {
  const bySku = new Map<string, OnboardSkuRow>();

  for (const row of instances) {
    if (!row.sku_id || !row.sku) continue;
    const existing = bySku.get(row.sku_id);
    if (existing) {
      existing.on_vessel += 1;
    } else {
      bySku.set(row.sku_id, {
        sku_id: row.sku_id,
        sku_code: row.sku.sku_code,
        name: row.sku.name,
        unit_of_measure: row.sku.unit_of_measure,
        on_vessel: 1,
      });
    }
  }

  return [...bySku.values()];
}

/** Map server-side onboard_sku_inventory RPC rows to UI rows. */
export function mapInventoryRpcRows(
  rows: Array<{
    sku_id: string;
    sku_code: string;
    name: string;
    unit_of_measure: string;
    aboard: number;
    on_manifest?: number;
    available?: number;
  }>,
  mode: "aboard" | "available" | "returns" = "aboard",
): OnboardSkuRow[] {
  return rows.map((row) => ({
    sku_id: row.sku_id,
    sku_code: row.sku_code,
    name: row.name,
    unit_of_measure: row.unit_of_measure,
    on_vessel:
      mode === "available" || mode === "returns"
        ? (row.available ?? row.aboard)
        : row.aboard,
    on_manifest: row.on_manifest,
    available: row.available,
  }));
}

export type BlockingSkuRow = {
  sku_code: string;
  name: string;
  qty: number;
  statuses: string[];
};

export function groupBlockersBySku(
  blockers: Array<{
    id: string;
    status: string;
    sku: { sku_code: string; name: string } | null;
  }>,
): BlockingSkuRow[] {
  const bySku = new Map<string, BlockingSkuRow>();

  for (const b of blockers) {
    const code = b.sku?.sku_code ?? b.id.slice(0, 8);
    const existing = bySku.get(code);
    if (existing) {
      existing.qty += 1;
      if (!existing.statuses.includes(b.status)) existing.statuses.push(b.status);
    } else {
      bySku.set(code, {
        sku_code: code,
        name: b.sku?.name ?? "Item",
        qty: 1,
        statuses: [b.status],
      });
    }
  }

  return [...bySku.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type RestockSkuRow = {
  sku_id: string;
  sku_code: string;
  name: string;
  pending: number;
  received: number;
};

export function groupRestockBySku(
  items: Array<{
    received_back_at: string | null;
    material_instance: {
      sku_id?: string;
      sku: { sku_code: string; name: string } | null;
    } | null;
  }>,
): RestockSkuRow[] {
  const bySku = new Map<string, RestockSkuRow>();

  for (const item of items) {
    const inst = item.material_instance;
    const sku = inst?.sku;
    if (!sku) continue;
    const skuId = inst.sku_id ?? sku.sku_code;
    const existing = bySku.get(skuId);
    const isReceived = !!item.received_back_at;
    if (existing) {
      if (isReceived) existing.received += 1;
      else existing.pending += 1;
    } else {
      bySku.set(skuId, {
        sku_id: skuId,
        sku_code: sku.sku_code,
        name: sku.name,
        pending: isReceived ? 0 : 1,
        received: isReceived ? 1 : 0,
      });
    }
  }

  return [...bySku.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterSkuRows(rows: OnboardSkuRow[], query: string): OnboardSkuRow[] {
  const q = query.trim().toUpperCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.sku_code.toUpperCase().includes(q) ||
      row.name.toUpperCase().includes(q),
  );
}

export function onboardUsageStats(rows: OnboardSkuRow[]) {
  let units = 0;
  for (const row of rows) units += row.on_vessel;
  return { skuCount: rows.length, unitCount: units };
}

/** SKUs still aboard, excluding instances already on a return manifest. */
export function availableSkuRows(
  instances: OnboardInstance[],
  excludedInstanceIds: Set<string>,
): OnboardSkuRow[] {
  const available = instances.filter(
    (i) => i.status === "on_vessel" && !excludedInstanceIds.has(i.id),
  );
  return groupOnboardBySku(available);
}

export type ManifestSkuSummary = {
  sku_code: string;
  name: string;
  qty: number;
  condition: string;
};

export function groupManifestBySku(
  items: Array<{
    condition: string;
    material_instance: {
      sku: { sku_code: string; name: string } | null;
    } | null;
  }>,
): ManifestSkuSummary[] {
  const bySku = new Map<string, ManifestSkuSummary>();

  for (const item of items) {
    const sku = item.material_instance?.sku;
    if (!sku) continue;
    const key = `${sku.sku_code}|${item.condition}`;
    const existing = bySku.get(key);
    if (existing) {
      existing.qty += 1;
    } else {
      bySku.set(key, {
        sku_code: sku.sku_code,
        name: sku.name,
        qty: 1,
        condition: item.condition,
      });
    }
  }

  return [...bySku.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type AggregatedUsageLog = {
  key: string;
  sku_code: string;
  name: string;
  action_type: string;
  logged_at: string;
  qty: number;
  notes: string | null;
  location_on_vessel: string | null;
};

/** Collapse per-instance log rows into SKU batches for readability. */
export function aggregateRecentLogs(logs: UsageLogEntry[]): AggregatedUsageLog[] {
  const buckets = new Map<string, AggregatedUsageLog>();

  for (const log of logs) {
    const sku = log.material_instance?.sku;
    const minute = log.logged_at.slice(0, 16);
    const key = `${sku?.sku_code ?? "?"}|${log.action_type}|${minute}|${log.notes ?? ""}|${log.location_on_vessel ?? ""}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.qty += Number(log.qty) || 1;
    } else {
      buckets.set(key, {
        key: log.id,
        sku_code: sku?.sku_code ?? "—",
        name: sku?.name ?? "Item",
        action_type: log.action_type,
        logged_at: log.logged_at,
        qty: Number(log.qty) || 1,
        notes: log.notes,
        location_on_vessel: log.location_on_vessel,
      });
    }
  }

  return [...buckets.values()];
}
