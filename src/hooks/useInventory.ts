import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  INVENTORY_CATALOG_QUERY_KEY,
  patchInventoryCatalogAfterCreate,
  patchInventoryCatalogAfterReceive,
} from "@/lib/inventoryCatalogCache";
import {
  buildWarehouseInstanceRows,
  materialInstancesQueryKey,
  patchMaterialInstancesAfterWarehouseReceive,
  type MaterialInstanceCacheRow,
} from "@/lib/materialInstancesCache";
import { patchSkuListAfterCreate, patchSkuListAfterImport } from "@/lib/skuListCache";
import { supabase } from "@/lib/supabase";
import type { SkuPickerRow, SkuStockRow } from "@/hooks/useSkus";

export const INSTANCE_FETCH_LIMIT = 200;

export type MaterialInstancesResult = {
  instances: unknown[];
  totalCount: number;
  truncated: boolean;
};

export async function fetchMaterialInstances(status?: string): Promise<MaterialInstancesResult> {
  const { data, error } = await supabase().rpc("list_material_instances", {
    p_status: status || null,
    p_limit: INSTANCE_FETCH_LIMIT,
  });
  if (error) throw error;

  const payload = data as {
    instances: unknown[];
    total_count: number;
    truncated: boolean;
  };

  return {
    instances: payload.instances ?? [],
    totalCount: Number(payload.total_count ?? 0),
    truncated: Boolean(payload.truncated),
  };
}

export function useMaterialInstances(status?: string) {
  return useQuery({
    queryKey: materialInstancesQueryKey(status),
    queryFn: () => fetchMaterialInstances(status),
  });
}

export function useCreateSku() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sku_code: string;
      name: string;
      category?: string;
      default_cost?: number;
      unit_of_measure?: string;
    }) => {
      if (!profile) throw new Error("Not authenticated");
      const { data: sku, error } = await supabase()
        .from("skus")
        .insert({
          org_id: profile.org_id,
          sku_code: input.sku_code.trim(),
          name: input.name.trim(),
          category: input.category?.trim() || null,
          default_cost: input.default_cost ?? null,
          unit_of_measure: input.unit_of_measure ?? "each",
        })
        .select("id, org_id, sku_code, name, category, unit_of_measure, default_cost, reorder_threshold")
        .single();
      if (error) throw error;
      return sku;
    },
    onSuccess: (sku) => {
      const stockRow: SkuStockRow = {
        sku_id: sku.id,
        org_id: sku.org_id,
        sku_code: sku.sku_code,
        name: sku.name,
        category: sku.category,
        unit_of_measure: sku.unit_of_measure,
        default_cost: sku.default_cost != null ? Number(sku.default_cost) : null,
        reorder_threshold:
          sku.reorder_threshold != null ? Number(sku.reorder_threshold) : null,
        on_hand: 0,
        allocated: 0,
        in_field: 0,
      };
      const pickerRow: SkuPickerRow = {
        id: sku.id,
        sku_code: sku.sku_code,
        name: sku.name,
        category: sku.category,
        unit_of_measure: sku.unit_of_measure,
        default_cost: sku.default_cost != null ? Number(sku.default_cost) : null,
        active: true,
      };
      patchInventoryCatalogAfterCreate(qc, stockRow);
      patchSkuListAfterCreate(qc, pickerRow);
    },
  });
}

export function useReceiveStock() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      skuId,
      qty,
    }: {
      skuId: string;
      qty: number;
    }) => {
      if (!profile) throw new Error("Not authenticated");

      const { data: sku } = await supabase()
        .from("skus")
        .select("id, sku_code, name, unit_of_measure, default_cost")
        .eq("id", skuId)
        .single();

      const { data: loc } = await supabase()
        .from("locations")
        .select("id, name, code")
        .eq("type", "warehouse")
        .limit(1)
        .maybeSingle();

      const rows = Array.from({ length: qty }, () => ({
        org_id: profile.org_id,
        sku_id: skuId,
        status: "in_stock" as const,
        current_location_id: loc?.id ?? null,
        acquired_cost: sku?.default_cost ?? null,
      }));

      const { data: inserted, error } = await supabase()
        .from("material_instances")
        .insert(rows)
        .select(
          "id, status, serial_number, lot_number, acquired_cost, acquired_at, notes, created_at, sku_id",
        );
      if (error) throw error;
      return {
        skuId,
        qty,
        sku,
        location: loc ? { name: loc.name, code: loc.code } : null,
        inserted: inserted ?? [],
      };
    },
    onSuccess: ({ skuId, qty, sku, location, inserted }) => {
      patchInventoryCatalogAfterReceive(qc, skuId, qty);
      if (sku && inserted.length > 0) {
        patchMaterialInstancesAfterWarehouseReceive(
          qc,
          buildWarehouseInstanceRows(inserted, sku, location),
        );
      }
    },
  });
}

export function useImportSkusCsv() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (rows: Array<{
      sku_code: string;
      name: string;
      category?: string;
      default_cost?: number;
      unit_of_measure?: string;
      initial_qty?: number;
    }>) => {
      if (!profile) throw new Error("Not authenticated");

      const stockRows: SkuStockRow[] = [];
      const pickerRows: SkuPickerRow[] = [];
      const instanceRows: MaterialInstanceCacheRow[] = [];

      const { data: loc } = await supabase()
        .from("locations")
        .select("id, name, code")
        .eq("type", "warehouse")
        .limit(1)
        .maybeSingle();

      for (const row of rows) {
        const { data: sku, error: skuErr } = await supabase()
          .from("skus")
          .upsert(
            {
              org_id: profile.org_id,
              sku_code: row.sku_code.trim(),
              name: row.name.trim(),
              category: row.category?.trim() || null,
              default_cost: row.default_cost ?? null,
              unit_of_measure: row.unit_of_measure ?? "each",
              active: true,
            },
            { onConflict: "org_id,sku_code" },
          )
          .select(
            "id, org_id, sku_code, name, category, unit_of_measure, default_cost, reorder_threshold",
          )
          .single();

        if (skuErr) throw skuErr;

        const qty = row.initial_qty ?? 0;
        const stockRow: SkuStockRow = {
          sku_id: sku.id,
          org_id: sku.org_id,
          sku_code: sku.sku_code,
          name: sku.name,
          category: sku.category,
          unit_of_measure: sku.unit_of_measure,
          default_cost: sku.default_cost != null ? Number(sku.default_cost) : null,
          reorder_threshold:
            sku.reorder_threshold != null ? Number(sku.reorder_threshold) : null,
          on_hand: qty,
          allocated: 0,
          in_field: 0,
        };
        stockRows.push(stockRow);
        pickerRows.push({
          id: sku.id,
          sku_code: sku.sku_code,
          name: sku.name,
          category: sku.category,
          unit_of_measure: sku.unit_of_measure,
          default_cost: sku.default_cost != null ? Number(sku.default_cost) : null,
          active: true,
        });

        if (qty > 0 && sku) {
          const instances = Array.from({ length: qty }, () => ({
            org_id: profile.org_id,
            sku_id: sku.id,
            status: "in_stock" as const,
            current_location_id: loc?.id ?? null,
            acquired_cost: row.default_cost ?? sku.default_cost ?? null,
          }));

          const { data: inserted, error: instErr } = await supabase()
            .from("material_instances")
            .insert(instances)
            .select(
              "id, status, serial_number, lot_number, acquired_cost, acquired_at, notes, created_at, sku_id",
            );
          if (instErr) throw instErr;

          instanceRows.push(
            ...buildWarehouseInstanceRows(
              inserted ?? [],
              {
                id: sku.id,
                sku_code: sku.sku_code,
                name: sku.name,
                unit_of_measure: sku.unit_of_measure,
              },
              loc ? { name: loc.name, code: loc.code } : null,
            ),
          );
        }
      }

      return { stockRows, pickerRows, instanceRows };
    },
    onSuccess: ({ stockRows, pickerRows, instanceRows }) => {
      for (const row of stockRows) {
        const existing = qc
          .getQueryData<{ stock: SkuStockRow[] }>(INVENTORY_CATALOG_QUERY_KEY)
          ?.stock.find((s) => s.sku_id === row.sku_id);
        if (existing) {
          patchInventoryCatalogAfterReceive(qc, row.sku_id, row.on_hand);
        } else {
          patchInventoryCatalogAfterCreate(qc, row);
        }
      }
      patchSkuListAfterImport(qc, pickerRows);
      if (instanceRows.length > 0) {
        patchMaterialInstancesAfterWarehouseReceive(qc, instanceRows);
      }
    },
  });
}
