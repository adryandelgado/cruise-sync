import type { QueryClient } from "@tanstack/react-query";
import type { ReturnRestockJob } from "@/hooks/useClosure";
import { patchCspoStatusIfAboardCleared } from "@/lib/cspoDetailCache";
import { patchInventoryCatalogAfterReceive } from "@/lib/inventoryCatalogCache";
import { patchMaterialInstancesAfterRestockReceive } from "@/lib/materialInstancesCache";
import {
  patchReturnRestockAfterReceive,
  patchReturnRestockRemoveManifest,
  patchReturnRestockSetSkuProgress,
} from "@/lib/restockSessionCache";
import { supabase } from "@/lib/supabase";

export type ReceiveReturnSkuQtyVars = {
  manifestId: string;
  skuId: string;
  qty?: number;
  condition?: "good" | "damaged" | "needs_inspection";
};

export type ReceiveReturnSkuQtyPayload = {
  received: number;
  pending: number;
};

export type ReceiveReturnSkuQtyMutationResult = {
  manifestId: string;
  skuId: string;
  result: ReceiveReturnSkuQtyPayload;
  queued?: boolean;
};

export type CompleteReturnReceiptVars = {
  manifestId: string;
};

export type CompleteReturnReceiptMutationResult = {
  manifestId: string;
  queued?: boolean;
};

function restockJobCspoId(qc: QueryClient, manifestId: string) {
  return qc
    .getQueryData<ReturnRestockJob[]>(["return-receipt-jobs"])
    ?.find((row) => row.manifest_id === manifestId)?.cspo_id;
}

function restockSkuRow(qc: QueryClient, manifestId: string, skuId: string) {
  return qc
    .getQueryData<ReturnRestockJob[]>(["return-receipt-jobs"])
    ?.find((row) => row.manifest_id === manifestId)
    ?.skus.find((row) => row.sku_id === skuId);
}

export async function executeReceiveReturnSkuQtyRpc(
  vars: ReceiveReturnSkuQtyVars,
): Promise<ReceiveReturnSkuQtyMutationResult> {
  const { data, error } = await supabase().rpc("receive_return_sku_qty", {
    p_manifest_id: vars.manifestId,
    p_sku_id: vars.skuId,
    p_qty: vars.qty ?? 1,
    p_condition: vars.condition ?? "good",
  });
  if (error) throw error;

  return {
    manifestId: vars.manifestId,
    skuId: vars.skuId,
    result: data as ReceiveReturnSkuQtyPayload,
  };
}

export function applyReceiveReturnSkuQtySuccess(
  qc: QueryClient,
  { manifestId, skuId, result }: ReceiveReturnSkuQtyMutationResult,
) {
  patchReturnRestockAfterReceive(qc, manifestId, skuId, result);
  const cspoId = restockJobCspoId(qc, manifestId);
  if (cspoId) {
    patchCspoStatusIfAboardCleared(qc, cspoId);
  }
  if (result.received > 0) {
    patchInventoryCatalogAfterReceive(qc, skuId, result.received);
    patchMaterialInstancesAfterRestockReceive(qc, skuId, result.received);
  }
}

export function buildOfflineReceiveReturnSkuQtyResult(
  qc: QueryClient,
  vars: ReceiveReturnSkuQtyVars,
): ReceiveReturnSkuQtyMutationResult {
  const skuRow = restockSkuRow(qc, vars.manifestId, vars.skuId);
  const qty = Math.min(vars.qty ?? 1, skuRow?.pending ?? vars.qty ?? 1);

  return {
    manifestId: vars.manifestId,
    skuId: vars.skuId,
    result: {
      received: qty,
      pending: Math.max(0, (skuRow?.pending ?? 0) - qty),
    },
    queued: true,
  };
}

export function reconcileReceiveReturnSkuQtyReplay(
  qc: QueryClient,
  vars: ReceiveReturnSkuQtyVars,
  result: ReceiveReturnSkuQtyPayload,
) {
  const skuRow = restockSkuRow(qc, vars.manifestId, vars.skuId);
  const optimisticQty = vars.qty ?? 1;

  if (skuRow && result.received !== optimisticQty) {
    const priorReceived = Math.max(0, skuRow.received - optimisticQty);
    patchReturnRestockSetSkuProgress(qc, vars.manifestId, vars.skuId, {
      received: priorReceived + result.received,
      pending: result.pending,
    });

    const inventoryDelta = result.received - optimisticQty;
    if (inventoryDelta !== 0) {
      patchInventoryCatalogAfterReceive(qc, vars.skuId, inventoryDelta);
      patchMaterialInstancesAfterRestockReceive(qc, vars.skuId, inventoryDelta);
    }

    const cspoId = restockJobCspoId(qc, vars.manifestId);
    if (cspoId) {
      patchCspoStatusIfAboardCleared(qc, cspoId);
    }
    return;
  }

  if (!skuRow) {
    applyReceiveReturnSkuQtySuccess(qc, {
      manifestId: vars.manifestId,
      skuId: vars.skuId,
      result,
    });
    return;
  }

  patchReturnRestockSetSkuProgress(qc, vars.manifestId, vars.skuId, {
    received: skuRow.received,
    pending: result.pending,
  });
}

export async function executeCompleteReturnReceiptRpc(
  manifestId: string,
): Promise<CompleteReturnReceiptMutationResult> {
  const { error } = await supabase().rpc("complete_return_manifest_receipt", {
    p_manifest_id: manifestId,
  });
  if (error) throw error;
  return { manifestId };
}

export function applyCompleteReturnReceiptSuccess(
  qc: QueryClient,
  manifestId: string,
) {
  const cspoId = restockJobCspoId(qc, manifestId);
  patchReturnRestockRemoveManifest(qc, manifestId);
  if (cspoId) {
    patchCspoStatusIfAboardCleared(qc, cspoId);
  }
}

export function buildOfflineCompleteReturnReceiptResult(
  manifestId: string,
): CompleteReturnReceiptMutationResult {
  return { manifestId, queued: true };
}

export function reconcileCompleteReturnReceiptReplay(
  qc: QueryClient,
  manifestId: string,
) {
  const stillInCache = qc
    .getQueryData<ReturnRestockJob[]>(["return-receipt-jobs"])
    ?.some((row) => row.manifest_id === manifestId);

  if (!stillInCache) return;
  applyCompleteReturnReceiptSuccess(qc, manifestId);
}
