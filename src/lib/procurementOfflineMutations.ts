import type { QueryClient } from "@tanstack/react-query";
import type { PackSession } from "@/hooks/usePackJobs";
import { patchDashboardProcurementDelta } from "@/lib/dashboardStatsCache";
import { patchInventoryCatalogAfterReceive } from "@/lib/inventoryCatalogCache";
import {
  mapProcurementInstancesToCache,
  patchMaterialInstancesAfterWarehouseReceive,
  type MaterialInstanceCacheRow,
} from "@/lib/materialInstancesCache";
import {
  patchMaterialListAfterProcurementReceive,
  patchWorkflowFromMaterialList,
} from "@/lib/materialListCache";
import {
  PROCUREMENT_HUB_QUERY_KEY,
  type ProcurementHub,
  type ProcurementRequestRow,
} from "@/lib/procurementHubCache";
import {
  patchPackSessionAfterProcurementReceive,
  patchProcurementAfterReceive,
} from "@/lib/procurementSessionCache";
import { patchReportsOverviewDelta } from "@/lib/reportsCache";
import { patchWarehouseHubFromPackList } from "@/lib/warehouseHubCache";
import { supabase } from "@/lib/supabase";

export type ReceiveProcurementVars = {
  requestId: string;
  qty: number;
};

export type ReceiveProcurementMutationResult = {
  requestId: string;
  qtyReceived: number;
  cspoId: string | null;
  listId: string | null;
  procurementStatus: string;
  instances: MaterialInstanceCacheRow[];
  queued?: boolean;
};

function procurementRequestFromHub(
  qc: QueryClient,
  requestId: string,
): ProcurementRequestRow | undefined {
  return qc
    .getQueryData<ProcurementHub>(PROCUREMENT_HUB_QUERY_KEY)
    ?.requests.find((row) => row.id === requestId);
}

function findCspoIdForProcurementRequest(qc: QueryClient, requestId: string): string | null {
  for (const query of qc.getQueryCache().findAll({ queryKey: ["pack-session"] })) {
    const cspoId = query.queryKey[1];
    if (typeof cspoId !== "string") continue;
    const session = query.state.data as PackSession | undefined;
    if (!session) continue;
    if (session.list.items.some((item) => item.procurement_request_id === requestId)) {
      return cspoId;
    }
  }
  return null;
}

function computeProcurementStatusAfterReceive(
  qtyNeeded: number,
  qtyReceivedBefore: number,
  qtyReceived: number,
): string {
  return qtyReceivedBefore + qtyReceived >= qtyNeeded ? "received" : "partial";
}

function mapReceiveProcurementRpc(data: unknown): Omit<ReceiveProcurementMutationResult, "qtyReceived"> & {
  qtyReceived: number;
} {
  const result = data as {
    request_id?: string;
    cspo_id?: string | null;
    list_id?: string | null;
    procurement_status?: string;
    sku_id?: string;
    instances?: unknown[];
  } | null;

  return {
    requestId: result?.request_id ?? "",
    qtyReceived: 0,
    cspoId: result?.cspo_id ?? null,
    listId: result?.list_id ?? null,
    procurementStatus: result?.procurement_status ?? "partial",
    instances: mapProcurementInstancesToCache(
      (result?.instances ?? []) as Parameters<typeof mapProcurementInstancesToCache>[0],
    ),
  };
}

export async function executeReceiveProcurementRpc(
  vars: ReceiveProcurementVars,
): Promise<ReceiveProcurementMutationResult> {
  const { data, error } = await supabase().rpc("receive_procurement", {
    p_request_id: vars.requestId,
    p_qty_received: vars.qty,
  });
  if (error) throw error;

  const mapped = mapReceiveProcurementRpc(data);
  return {
    ...mapped,
    requestId: vars.requestId,
    qtyReceived: vars.qty,
  };
}

export function applyReceiveProcurementSuccess(
  qc: QueryClient,
  {
    requestId,
    qtyReceived,
    cspoId,
    procurementStatus,
    instances,
  }: ReceiveProcurementMutationResult,
) {
  const req = procurementRequestFromHub(qc, requestId);
  const skuId = req?.sku?.id;
  const resolvedCspoId = cspoId ?? findCspoIdForProcurementRequest(qc, requestId);

  patchProcurementAfterReceive(qc, requestId, qtyReceived, procurementStatus);

  if (resolvedCspoId && skuId) {
    patchPackSessionAfterProcurementReceive(
      qc,
      resolvedCspoId,
      requestId,
      skuId,
      qtyReceived,
      procurementStatus,
    );
    patchMaterialListAfterProcurementReceive(qc, resolvedCspoId, requestId);
    const session = qc.getQueryData<PackSession>(["pack-session", resolvedCspoId]);
    if (session) {
      patchWarehouseHubFromPackList(qc, resolvedCspoId, session.list);
    }
  }

  if (procurementStatus === "received") {
    patchDashboardProcurementDelta(qc, -1);
    patchReportsOverviewDelta(qc, "procurementLagCount", -1);
  }

  if (skuId) {
    patchInventoryCatalogAfterReceive(qc, skuId, qtyReceived);
  }

  if (instances.length > 0) {
    patchMaterialInstancesAfterWarehouseReceive(qc, instances);
  }

  if (resolvedCspoId) {
    patchWorkflowFromMaterialList(qc, resolvedCspoId);
  }
}

export function buildOfflineReceiveProcurementResult(
  qc: QueryClient,
  vars: ReceiveProcurementVars,
): ReceiveProcurementMutationResult {
  const req = procurementRequestFromHub(qc, vars.requestId);
  const remaining = req
    ? Math.max(0, Number(req.qty_needed) - Number(req.qty_received))
    : vars.qty;
  const qtyReceived = Math.min(vars.qty, remaining);
  const procurementStatus = req
    ? computeProcurementStatusAfterReceive(
        Number(req.qty_needed),
        Number(req.qty_received),
        qtyReceived,
      )
    : "partial";

  return {
    requestId: vars.requestId,
    qtyReceived,
    cspoId: findCspoIdForProcurementRequest(qc, vars.requestId),
    listId: null,
    procurementStatus,
    instances: [],
    queued: true,
  };
}

export function reconcileReceiveProcurementReplay(
  qc: QueryClient,
  vars: ReceiveProcurementVars,
  result: ReceiveProcurementMutationResult,
) {
  const req = procurementRequestFromHub(qc, vars.requestId);

  if (!req) {
    if (result.instances.length > 0) {
      patchMaterialInstancesAfterWarehouseReceive(qc, result.instances);
    }
    return;
  }

  if (result.qtyReceived !== vars.qty) {
    const priorReceived = Math.max(0, Number(req.qty_received) - vars.qty);
    const correctedStatus = computeProcurementStatusAfterReceive(
      Number(req.qty_needed),
      priorReceived,
      result.qtyReceived,
    );
    patchProcurementAfterReceive(qc, vars.requestId, -vars.qty, req.status);
    patchProcurementAfterReceive(qc, vars.requestId, result.qtyReceived, correctedStatus);

    const skuId = req.sku?.id;
    const cspoId = result.cspoId ?? findCspoIdForProcurementRequest(qc, vars.requestId);
    if (cspoId && skuId) {
      patchPackSessionAfterProcurementReceive(
        qc,
        cspoId,
        vars.requestId,
        skuId,
        result.qtyReceived - vars.qty,
        correctedStatus,
      );
      patchMaterialListAfterProcurementReceive(qc, cspoId, vars.requestId);
      patchWorkflowFromMaterialList(qc, cspoId);
    }

    const inventoryDelta = result.qtyReceived - vars.qty;
    if (skuId && inventoryDelta !== 0) {
      patchInventoryCatalogAfterReceive(qc, skuId, inventoryDelta);
    }
  }

  if (result.instances.length > 0) {
    patchMaterialInstancesAfterWarehouseReceive(qc, result.instances);
  }
}
