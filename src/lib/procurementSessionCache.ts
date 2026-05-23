import type { QueryClient } from "@tanstack/react-query";
import type { PackSession } from "@/hooks/usePackJobs";
import {
  patchProcurementHubAfterReceive,
  type ProcurementRequestRow,
} from "@/lib/procurementHubCache";

export type { ProcurementRequestRow };

export function patchProcurementAfterReceive(
  qc: QueryClient,
  requestId: string,
  qtyReceived: number,
  newStatus: string,
) {
  patchProcurementHubAfterReceive(qc, requestId, qtyReceived, newStatus);
}

export function patchPackSessionAfterProcurementReceive(
  qc: QueryClient,
  cspoId: string,
  requestId: string,
  skuId: string,
  qtyReceived: number,
  procurementStatus: string,
) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;

    const items = old.list.items.map((item) => {
      if (item.procurement_request_id !== requestId) return item;
      const pr = item.procurement_request;
      return {
        ...item,
        status: "pending",
        procurement_request: pr
          ? {
              ...pr,
              status: procurementStatus,
              qty_received: Number(pr.qty_received) + qtyReceived,
            }
          : null,
      };
    });

    const stillProcuring = items.some((i) => i.status === "procuring");
    let listStatus = old.list.status;
    if (old.list.status === "awaiting_procurement" || old.list.status === "submitted") {
      listStatus = stillProcuring ? "partially_packed" : "in_packing";
    } else if (stillProcuring && old.list.status !== "partially_packed") {
      listStatus = "partially_packed";
    } else if (!stillProcuring && old.list.status === "partially_packed") {
      listStatus = "in_packing";
    }

    const stockBySku = { ...old.stockBySku };
    stockBySku[skuId] = (stockBySku[skuId] ?? 0) + qtyReceived;

    return {
      ...old,
      list: { ...old.list, status: listStatus, items },
      stockBySku,
    };
  });
}

export function patchPackSessionAfterProcurementCreate(
  qc: QueryClient,
  cspoId: string,
  listItemId: string,
  requestId: string,
  qtyNeeded: number,
) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;

    const items = old.list.items.map((item) => {
      if (item.id !== listItemId) return item;
      return {
        ...item,
        status: "procuring",
        procurement_request_id: requestId,
        procurement_request: {
          id: requestId,
          status: "open",
          qty_needed: qtyNeeded,
          qty_received: 0,
        },
      };
    });

    const awaitingProcurement = items.some((item) => item.status === "procuring");
    let listStatus = old.list.status;
    if (
      awaitingProcurement &&
      (old.list.status === "submitted" || old.list.status === "in_packing")
    ) {
      listStatus = "awaiting_procurement";
    }

    return {
      ...old,
      list: { ...old.list, status: listStatus, items },
    };
  });
}
