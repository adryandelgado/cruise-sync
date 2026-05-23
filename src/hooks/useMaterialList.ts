import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  type AddMaterialListPatch,
  patchMaterialListAfterAdd,
  patchMaterialListAfterRemove,
  patchMaterialListAfterSubmit,
  patchPackSessionAfterMaterialListChange,
  patchPackSessionAfterMaterialListRemove,
  patchWorkflowFromMaterialList,
} from "@/lib/materialListCache";
import { patchCspoStatus } from "@/lib/cspoDetailCache";
import { patchDashboardAfterListSubmitted } from "@/lib/dashboardStatsCache";
import { patchWarehouseHubFromMaterialList } from "@/lib/warehouseHubCache";
import { supabase } from "@/lib/supabase";
import { readSkuStockCache } from "@/lib/inventoryCatalogCache";

export type MaterialListItemRow = {
  id: string;
  sku_id: string | null;
  custom_description: string | null;
  requested_qty: number;
  packed_qty: number;
  status: string;
  notes: string | null;
  sku: {
    id: string;
    sku_code: string;
    name: string;
    unit_of_measure: string;
  } | null;
};

export type MaterialListRow = {
  id: string;
  cspo_id: string;
  status: string;
  submitted_at: string | null;
  items: MaterialListItemRow[];
};

export function materialListQueryKey(cspoId: string) {
  return ["material-list", cspoId] as const;
}

export async function fetchMaterialList(cspoId: string): Promise<MaterialListRow | null> {
  const { data: list, error: listErr } = await supabase()
    .from("material_lists")
    .select("id, cspo_id, status, submitted_at")
    .eq("cspo_id", cspoId)
    .maybeSingle();

  if (listErr) throw listErr;
  if (!list) return null;

  const { data: items, error: itemsErr } = await supabase()
    .from("material_list_items")
    .select(`
      id, sku_id, custom_description, requested_qty, packed_qty, status, notes,
      sku:skus(id, sku_code, name, unit_of_measure)
    `)
    .eq("list_id", list.id)
    .order("created_at");

  if (itemsErr) throw itemsErr;

  return {
    ...list,
    items: (items ?? []) as unknown as MaterialListItemRow[],
  } as MaterialListRow;
}

export function useMaterialList(cspoId: string) {
  return useQuery({
    queryKey: materialListQueryKey(cspoId),
    queryFn: () => fetchMaterialList(cspoId),
  });
}

export type AddMaterialListItemInput = {
  cspoId: string;
  skuId?: string;
  customDescription?: string;
  requestedQty: number;
  notes?: string;
};

export function useAddMaterialListItem() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddMaterialListItemInput): Promise<AddMaterialListPatch> => {
      if (!profile) throw new Error("Not authenticated");

      const listId = await ensureMaterialList(input.cspoId, profile.org_id);

      const { data: list, error: listErr } = await supabase()
        .from("material_lists")
        .select("status")
        .eq("id", listId)
        .single();

      if (listErr) throw listErr;

      let listReopened = false;
      if (
        list.status === "complete" ||
        list.status === "submitted" ||
        list.status === "partially_packed"
      ) {
        const { error: reopenErr } = await supabase().rpc(
          "reopen_material_list_for_packing",
          { p_cspo_id: input.cspoId },
        );
        if (reopenErr) throw reopenErr;
        listReopened = true;
      }

      if (input.skuId) {
        const { data: existing, error: existingErr } = await supabase()
          .from("material_list_items")
          .select("id, requested_qty")
          .eq("list_id", listId)
          .eq("sku_id", input.skuId)
          .maybeSingle();

        if (existingErr) throw existingErr;

        if (existing) {
          const { error: updateErr } = await supabase()
            .from("material_list_items")
            .update({
              requested_qty: Number(existing.requested_qty) + input.requestedQty,
            })
            .eq("id", existing.id);
          if (updateErr) throw updateErr;
          return {
            cspoId: input.cspoId,
            kind: "merge",
            itemId: existing.id,
            requestedQtyDelta: input.requestedQty,
            listReopened,
          };
        }
      }

      const { data: inserted, error } = await supabase()
        .from("material_list_items")
        .insert({
          org_id: profile.org_id,
          list_id: listId,
          sku_id: input.skuId ?? null,
          custom_description: input.customDescription ?? null,
          requested_qty: input.requestedQty,
          notes: input.notes ?? null,
        })
        .select("id")
        .single();

      if (error) throw error;

      if (input.skuId) {
        const { data: sku } = await supabase()
          .from("skus")
          .select("id, sku_code, name, unit_of_measure")
          .eq("id", input.skuId)
          .single();
        return {
          cspoId: input.cspoId,
          kind: "insert",
          itemId: inserted.id,
          skuId: input.skuId,
          customDescription: input.customDescription ?? null,
          requestedQty: input.requestedQty,
          listReopened,
          sku: sku ?? null,
        };
      }

      return {
        cspoId: input.cspoId,
        kind: "insert",
        itemId: inserted.id,
        skuId: input.skuId ?? null,
        customDescription: input.customDescription ?? null,
        requestedQty: input.requestedQty,
        listReopened,
        sku: null,
      };
    },
    onSuccess: (patch) => {
      let resolved = patch;
      if (patch.kind === "insert" && patch.skuId && !patch.sku) {
        const stock = readSkuStockCache(qc);
        const row = stock?.find((s) => s.sku_id === patch.skuId);
        if (row) {
          resolved = {
            ...patch,
            sku: {
              id: row.sku_id,
              sku_code: row.sku_code,
              name: row.name,
              unit_of_measure: row.unit_of_measure,
            },
          };
        }
      }

      patchMaterialListAfterAdd(qc, resolved);
      patchPackSessionAfterMaterialListChange(qc, resolved.cspoId, resolved);
      patchWarehouseHubFromMaterialList(qc, resolved.cspoId);
      patchWorkflowFromMaterialList(qc, resolved.cspoId);
    },
  });
}

export function useRemoveMaterialListItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, cspoId }: { itemId: string; cspoId: string }) => {
      const { error } = await supabase().rpc("remove_material_list_item", {
        p_item_id: itemId,
      });
      if (error) throw error;
      return { itemId, cspoId };
    },
    onSuccess: ({ itemId, cspoId }) => {
      patchMaterialListAfterRemove(qc, cspoId, itemId);
      patchPackSessionAfterMaterialListRemove(qc, cspoId, itemId);
      patchWarehouseHubFromMaterialList(qc, cspoId);
      patchWorkflowFromMaterialList(qc, cspoId);
    },
  });
}

export function useSubmitMaterialList() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (cspoId: string) => {
      if (!profile) throw new Error("Not authenticated");

      const { data: list, error: listErr } = await supabase()
        .from("material_lists")
        .select("id, status")
        .eq("cspo_id", cspoId)
        .single();

      if (listErr) throw listErr;
      if (list.status !== "draft") {
        throw new Error("Material list has already been submitted");
      }

      const { count, error: countErr } = await supabase()
        .from("material_list_items")
        .select("id", { count: "exact", head: true })
        .eq("list_id", list.id);

      if (countErr) throw countErr;
      if (!count) throw new Error("Add at least one item before submitting");

      const now = new Date().toISOString();

      const { error: listUpdateErr } = await supabase()
        .from("material_lists")
        .update({ status: "submitted", submitted_at: now, submitted_by: profile.id })
        .eq("id", list.id);

      if (listUpdateErr) throw listUpdateErr;

      const { error: cspoErr } = await supabase()
        .from("cruise_ship_pos")
        .update({ status: "packing" })
        .eq("id", cspoId);

      if (cspoErr) throw cspoErr;
      return cspoId;
    },
    onSuccess: (cspoId) => {
      patchMaterialListAfterSubmit(qc, cspoId);
      patchCspoStatus(qc, cspoId, "packing");
      patchDashboardAfterListSubmitted(qc);
      patchWarehouseHubFromMaterialList(qc, cspoId);
      patchWorkflowFromMaterialList(qc, cspoId);
    },
  });
}

async function ensureMaterialList(cspoId: string, orgId: string): Promise<string> {
  const { data: existing } = await supabase()
    .from("material_lists")
    .select("id")
    .eq("cspo_id", cspoId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase()
    .from("material_lists")
    .insert({ org_id: orgId, cspo_id: cspoId })
    .select("id")
    .single();

  if (error) throw error;
  return created.id;
}

export async function seedMaterialListFromProposal(
  cspoId: string,
  proposalId: string,
  orgId: string,
): Promise<void> {
  const { data: lines, error: linesErr } = await supabase()
    .from("proposal_line_items")
    .select("sku_id, custom_description, qty")
    .eq("proposal_id", proposalId);

  if (linesErr) throw linesErr;
  if (!lines?.length) return;

  const { data: list, error: listErr } = await supabase()
    .from("material_lists")
    .insert({ org_id: orgId, cspo_id: cspoId })
    .select("id")
    .single();

  if (listErr) throw listErr;

  const { error: itemsErr } = await supabase().from("material_list_items").insert(
    lines.map((line) => ({
      org_id: orgId,
      list_id: list.id,
      sku_id: line.sku_id,
      custom_description: line.custom_description,
      requested_qty: line.qty,
    })),
  );

  if (itemsErr) throw itemsErr;
}
