export type MaterialListItemQty = {
  requested_qty: number;
  packed_qty: number;
};

export type MaterialListGroup<T> = {
  key: string;
  sku_id: string | null;
  label: string;
  requested_qty: number;
  packed_qty: number;
  line_count: number;
  items: T[];
  status: string;
};

export function computeMaterialListStats<
  T extends MaterialListItemQty & {
    sku_id?: string | null;
    custom_description?: string | null;
    id?: string;
  },
>(items: T[]) {
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

  const uniqueSkus = new Set(
    items.map((item) => item.sku_id ?? `custom:${item.custom_description ?? item.id ?? "?"}`),
  ).size;

  return {
    totalLines: items.length,
    uniqueSkus,
    completeLines,
    totalUnits,
    packedUnits,
    remainingUnits: totalUnits - packedUnits,
  };
}

export function groupMaterialListBySku<
  T extends MaterialListItemQty & {
    id: string;
    sku_id: string | null;
    custom_description: string | null;
    status: string;
    sku?: { sku_code: string; name: string; unit_of_measure?: string } | null;
  },
>(items: T[]): MaterialListGroup<T>[] {
  const byKey = new Map<string, MaterialListGroup<T>>();

  for (const item of items) {
    const key = item.sku_id ?? `custom:${item.custom_description ?? item.id}`;
    const label = item.sku
      ? `${item.sku.sku_code} — ${item.sku.name}`
      : item.custom_description ?? "Custom item";

    const existing = byKey.get(key);
    if (existing) {
      existing.requested_qty += Number(item.requested_qty);
      existing.packed_qty += Number(item.packed_qty);
      existing.line_count += 1;
      existing.items.push(item);
      existing.status = mergeLineStatus(existing.status, item.status);
    } else {
      byKey.set(key, {
        key,
        sku_id: item.sku_id,
        label,
        requested_qty: Number(item.requested_qty),
        packed_qty: Number(item.packed_qty),
        line_count: 1,
        items: [item],
        status: item.status,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function mergeLineStatus(a: string, b: string): string {
  const rank = (s: string) =>
    s === "complete" || s === "packed" ? 3 : s === "partial" || s === "partially_packed" ? 2 : 1;
  return rank(a) >= rank(b) ? a : b;
}

export function filterMaterialListItems<
  T extends {
    sku?: { sku_code: string; name: string } | null;
    custom_description: string | null;
  },
>(items: T[], query: string): T[] {
  const q = query.trim().toUpperCase();
  if (!q) return items;
  return items.filter((item) => {
    const code = item.sku?.sku_code?.toUpperCase() ?? "";
    const name = item.sku?.name?.toUpperCase() ?? item.custom_description?.toUpperCase() ?? "";
    return code.includes(q) || name.includes(q);
  });
}

export function filterMaterialListGroups<T>(
  groups: MaterialListGroup<T>[],
  query: string,
): MaterialListGroup<T>[] {
  const q = query.trim().toUpperCase();
  if (!q) return groups;
  return groups.filter((g) => g.label.toUpperCase().includes(q));
}
