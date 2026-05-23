import type { QueryClient } from "@tanstack/react-query";
import type { SkuStockRow } from "@/hooks/useSkus";

export const INVENTORY_CATALOG_QUERY_KEY = ["inventory-catalog"] as const;

export type InventoryCatalogSummary = {
  skuCount: number;
  lowStockCount: number;
  totalOnHand: number;
};

export type InventoryCatalogHub = {
  stock: SkuStockRow[];
  summary: InventoryCatalogSummary;
};

export type InventoryCatalogHubRpc = {
  stock: SkuStockRow[];
  summary: {
    sku_count: number;
    low_stock_count: number;
    total_on_hand: number;
  };
};

export function mapInventoryCatalogFromRpc(payload: InventoryCatalogHubRpc): InventoryCatalogHub {
  const stock = (payload.stock ?? []).map((row) => ({
    ...row,
    default_cost: row.default_cost != null ? Number(row.default_cost) : null,
    reorder_threshold: row.reorder_threshold != null ? Number(row.reorder_threshold) : null,
    on_hand: Number(row.on_hand ?? 0),
    allocated: Number(row.allocated ?? 0),
    in_field: Number(row.in_field ?? 0),
  }));
  return {
    stock,
    summary: {
      skuCount: Number(payload.summary?.sku_count ?? stock.length),
      lowStockCount: Number(payload.summary?.low_stock_count ?? 0),
      totalOnHand: Number(payload.summary?.total_on_hand ?? 0),
    },
  };
}

function withSummary(stock: SkuStockRow[]): InventoryCatalogHub {
  return {
    stock,
    summary: {
      skuCount: stock.length,
      lowStockCount: stock.filter(
        (row) =>
          row.reorder_threshold != null && row.on_hand <= Number(row.reorder_threshold),
      ).length,
      totalOnHand: stock.reduce((sum, row) => sum + row.on_hand, 0),
    },
  };
}

export function patchInventoryCatalogAfterReceive(
  qc: QueryClient,
  skuId: string,
  qty: number,
) {
  if (qty <= 0) return;

  qc.setQueryData<InventoryCatalogHub>(INVENTORY_CATALOG_QUERY_KEY, (old) => {
    if (!old) return old;
    const stock = old.stock.map((row) =>
      row.sku_id === skuId ? { ...row, on_hand: row.on_hand + qty } : row,
    );
    return withSummary(stock);
  });
}

export function patchInventoryCatalogAfterCreate(
  qc: QueryClient,
  row: SkuStockRow,
) {
  qc.setQueryData<InventoryCatalogHub>(INVENTORY_CATALOG_QUERY_KEY, (old) => {
    if (!old) return old;
    return withSummary([...old.stock, row].sort((a, b) => a.sku_code.localeCompare(b.sku_code)));
  });
}

/** Read stock rows from cache (catalog hub or legacy sku-stock key). */
export function readSkuStockCache(qc: QueryClient): SkuStockRow[] | undefined {
  return (
    qc.getQueryData<InventoryCatalogHub>(INVENTORY_CATALOG_QUERY_KEY)?.stock ??
    qc.getQueryData<SkuStockRow[]>(["sku-stock"])
  );
}
