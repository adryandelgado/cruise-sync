import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  INVENTORY_CATALOG_QUERY_KEY,
  mapInventoryCatalogFromRpc,
  type InventoryCatalogHub,
  type InventoryCatalogHubRpc,
} from "@/lib/inventoryCatalogCache";
import { REFERENCE_STALE_MS } from "@/lib/queryStaleTimes";

export const SKU_LIST_QUERY_KEY = ["sku-list"] as const;

export type SkuStockRow = {
  sku_id: string;
  org_id: string;
  sku_code: string;
  name: string;
  category: string | null;
  unit_of_measure: string;
  default_cost: number | null;
  reorder_threshold: number | null;
  on_hand: number;
  allocated: number;
  in_field: number;
};

export type SkuPickerRow = {
  id: string;
  sku_code: string;
  name: string;
  category: string | null;
  unit_of_measure: string;
  default_cost: number | null;
  active: boolean;
};

export async function fetchInventoryCatalogHub(): Promise<InventoryCatalogHub> {
  const { data, error } = await supabase().rpc("get_inventory_catalog_hub");
  if (error) throw error;
  return mapInventoryCatalogFromRpc(data as InventoryCatalogHubRpc);
}

export function useInventoryCatalogHub() {
  return useQuery({
    queryKey: INVENTORY_CATALOG_QUERY_KEY,
    queryFn: fetchInventoryCatalogHub,
  });
}

export function useSkuStock() {
  const query = useInventoryCatalogHub();
  return {
    ...query,
    data: query.data?.stock,
  };
}

export async function fetchSkuList(): Promise<SkuPickerRow[]> {
  const { data, error } = await supabase().rpc("list_skus");
  if (error) throw error;
  return ((data ?? []) as SkuPickerRow[]).map((row) => ({
    ...row,
    default_cost: row.default_cost != null ? Number(row.default_cost) : null,
  }));
}

export function useSkus() {
  return useQuery({
    queryKey: SKU_LIST_QUERY_KEY,
    queryFn: fetchSkuList,
    staleTime: REFERENCE_STALE_MS,
  });
}
