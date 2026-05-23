import type { SkuStockRow } from "@/hooks/useSkus";

export function filterCatalogStock(
  stock: SkuStockRow[],
  query: string,
  category: string,
  lowStockOnly: boolean,
): SkuStockRow[] {
  const q = query.trim().toUpperCase();
  return stock.filter((s) => {
    if (category && (s.category ?? "") !== category) return false;
    if (lowStockOnly && (s.reorder_threshold == null || s.on_hand > s.reorder_threshold)) {
      return false;
    }
    if (!q) return true;
    return (
      s.sku_code.toUpperCase().includes(q) ||
      s.name.toUpperCase().includes(q) ||
      (s.category?.toUpperCase().includes(q) ?? false)
    );
  });
}

export function catalogCategories(stock: SkuStockRow[]): string[] {
  const cats = new Set<string>();
  for (const s of stock) {
    if (s.category) cats.add(s.category);
  }
  return [...cats].sort();
}
