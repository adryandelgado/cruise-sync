import { patchCspoDetailWorkflow } from "@/lib/cspoDetailCache";
import type { QueryClient } from "@tanstack/react-query";
import type { MaterialListItemRow, MaterialListRow } from "@/hooks/useMaterialList";
import type { PackSession } from "@/hooks/usePackJobs";

export function patchWorkflowFromMaterialList(qc: QueryClient, cspoId: string) {
  const list = qc.getQueryData<MaterialListRow | null>(["material-list", cspoId]);
  if (!list) return;
  patchCspoDetailWorkflow(qc, cspoId, {
    list_status: list.status,
    list_item_count: list.items.length,
  });
}

export type AddMaterialListPatch =
  | {
      cspoId: string;
      kind: "merge";
      itemId: string;
      requestedQtyDelta: number;
      listReopened: boolean;
    }
  | {
      cspoId: string;
      kind: "insert";
      itemId: string;
      skuId: string | null;
      customDescription: string | null;
      requestedQty: number;
      listReopened: boolean;
      sku?: {
        id: string;
        sku_code: string;
        name: string;
        unit_of_measure: string;
      } | null;
    };

export function patchMaterialListAfterAdd(qc: QueryClient, patch: AddMaterialListPatch) {
  qc.setQueryData<MaterialListRow | null>(["material-list", patch.cspoId], (old) => {
    const base: MaterialListRow = old ?? {
      id: `optimistic-list-${patch.cspoId}`,
      cspo_id: patch.cspoId,
      status: "draft",
      submitted_at: null,
      items: [],
    };

    const status = patch.listReopened && base.status === "complete" ? "submitted" : base.status;

    if (patch.kind === "merge") {
      return {
        ...base,
        status,
        items: base.items.map((item) =>
          item.id === patch.itemId
            ? {
                ...item,
                requested_qty: Number(item.requested_qty) + patch.requestedQtyDelta,
              }
            : item,
        ),
      };
    }

    const newItem: MaterialListItemRow = {
      id: patch.itemId,
      sku_id: patch.skuId,
      custom_description: patch.customDescription,
      requested_qty: patch.requestedQty,
      packed_qty: 0,
      status: "pending",
      notes: null,
      sku: patch.sku ?? null,
    };

    return {
      ...base,
      status,
      items: [...base.items, newItem],
    };
  });
}

export function patchMaterialListAfterRemove(
  qc: QueryClient,
  cspoId: string,
  itemId: string,
) {
  qc.setQueryData<MaterialListRow | null>(["material-list", cspoId], (old) => {
    if (!old) return old;
    return { ...old, items: old.items.filter((item) => item.id !== itemId) };
  });
}

export function patchMaterialListAfterSubmit(qc: QueryClient, cspoId: string) {
  const now = new Date().toISOString();
  let itemCount = 0;

  qc.setQueryData<MaterialListRow | null>(["material-list", cspoId], (old) => {
    if (!old) return old;
    itemCount = old.items.length;
    return { ...old, status: "submitted", submitted_at: now };
  });

  patchCspoDetailWorkflow(qc, cspoId, {
    list_status: "submitted",
    list_item_count: itemCount,
  });
}

export function patchPackSessionAfterMaterialListChange(
  qc: QueryClient,
  cspoId: string,
  patch: AddMaterialListPatch,
) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;

    if (patch.kind === "merge") {
      return {
        ...old,
        list: {
          ...old.list,
          items: old.list.items.map((item) =>
            item.id === patch.itemId
              ? {
                  ...item,
                  requested_qty: Number(item.requested_qty) + patch.requestedQtyDelta,
                }
              : item,
          ),
        },
      };
    }

    const newItem = {
      id: patch.itemId,
      sku_id: patch.skuId,
      custom_description: patch.customDescription,
      requested_qty: patch.requestedQty,
      packed_qty: 0,
      status: "pending",
      procurement_request_id: null,
      procurement_request: null,
      sku: patch.sku
        ? {
            sku_code: patch.sku.sku_code,
            name: patch.sku.name,
            unit_of_measure: patch.sku.unit_of_measure,
          }
        : null,
    };

    return {
      ...old,
      list: {
        ...old.list,
        items: [...old.list.items, newItem],
      },
    };
  });
}

export function patchPackSessionAfterMaterialListRemove(
  qc: QueryClient,
  cspoId: string,
  itemId: string,
) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      list: {
        ...old.list,
        items: old.list.items.filter((item) => item.id !== itemId),
      },
    };
  });
}

export function patchMaterialListAfterProcurementCreate(
  qc: QueryClient,
  cspoId: string,
  listItemId: string,
) {
  qc.setQueryData<MaterialListRow | null>(["material-list", cspoId], (old) => {
    if (!old) return old;

    const items = old.items.map((item) =>
      item.id === listItemId ? { ...item, status: "procuring" } : item,
    );

    const awaitingProcurement = items.some((item) => item.status === "procuring");
    let listStatus = old.status;
    if (
      awaitingProcurement &&
      (old.status === "submitted" || old.status === "in_packing")
    ) {
      listStatus = "awaiting_procurement";
    }

    return { ...old, status: listStatus, items };
  });
}

export function patchMaterialListAfterProcurementReceive(
  qc: QueryClient,
  cspoId: string,
  requestId: string,
) {
  const listItemId = qc
    .getQueryData<PackSession>(["pack-session", cspoId])
    ?.list.items.find((item) => item.procurement_request_id === requestId)?.id;

  qc.setQueryData<MaterialListRow | null>(["material-list", cspoId], (old) => {
    if (!old) return old;

    const items = old.items.map((item) => {
      if (listItemId ? item.id !== listItemId : item.status !== "procuring") return item;
      return { ...item, status: "pending" };
    });

    const stillProcuring = items.some((item) => item.status === "procuring");
    let listStatus = old.status;
    if (old.status === "awaiting_procurement" || old.status === "submitted") {
      listStatus = stillProcuring ? "partially_packed" : "in_packing";
    } else if (stillProcuring && old.status !== "partially_packed") {
      listStatus = "partially_packed";
    } else if (!stillProcuring && old.status === "partially_packed") {
      listStatus = "in_packing";
    }

    return { ...old, status: listStatus, items };
  });
}
