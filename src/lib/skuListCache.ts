import type { QueryClient } from "@tanstack/react-query";
import { SKU_LIST_QUERY_KEY, type SkuPickerRow } from "@/hooks/useSkus";

export function patchSkuListAfterCreate(qc: QueryClient, row: SkuPickerRow) {
  qc.setQueryData<SkuPickerRow[]>(SKU_LIST_QUERY_KEY, (old) => {
    if (!old) return old;
    if (old.some((sku) => sku.id === row.id)) return old;
    return [...old, row].sort((a, b) => a.sku_code.localeCompare(b.sku_code));
  });
}

export function patchSkuListAfterImport(qc: QueryClient, rows: SkuPickerRow[]) {
  if (rows.length === 0) return;
  qc.setQueryData<SkuPickerRow[]>(SKU_LIST_QUERY_KEY, (old) => {
    if (!old) return old;
    const byId = new Map(old.map((sku) => [sku.id, sku]));
    for (const row of rows) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    return [...byId.values()].sort((a, b) => a.sku_code.localeCompare(b.sku_code));
  });
}
