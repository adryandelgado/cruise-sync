import type { QueryClient } from "@tanstack/react-query";
import {
  CSPO_DETAIL_SESSION_QUERY_KEY,
  type CspoDetailSession,
  type CspoRow,
} from "@/hooks/useCspos";
import type { ReceiveSession } from "@/hooks/useOnboard";
import type { PackSession } from "@/hooks/usePackJobs";
import type { CspoWorkflowSummary } from "@/hooks/useClosure";
import { CSPO_LIST_QUERY_KEY, patchCspoListRow } from "@/lib/cspoListCache";

export function patchCspoStatus(
  qc: QueryClient,
  cspoId: string,
  status: string,
  extra?: Record<string, unknown>,
) {
  qc.setQueryData<{ detail: Record<string, unknown> }>(["cspos", cspoId], (old) => {
    if (!old?.detail) return old;
    return { detail: { ...old.detail, status, ...extra } };
  });

  patchCspoListRow(qc, cspoId, { status, ...(extra as Partial<CspoRow>) });

  qc.setQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      cspo: { ...old.cspo, status, ...extra },
    };
  });
}

export function patchCspoDetailWorkflow(
  qc: QueryClient,
  cspoId: string,
  patch: Partial<CspoWorkflowSummary>,
) {
  qc.setQueryData<CspoWorkflowSummary>(["cspo-workflow-summary", cspoId], (old) => {
    if (!old) return old;
    return { ...old, ...patch };
  });

  qc.setQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      workflow: { ...old.workflow, ...patch },
    };
  });
}

function workflowSnapshot(qc: QueryClient, cspoId: string): CspoWorkflowSummary | undefined {
  return (
    qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId])?.workflow ??
    qc.getQueryData<CspoWorkflowSummary>(["cspo-workflow-summary", cspoId])
  );
}

/** Sync CSPO detail + workflow after a package is received aboard. */
export function patchCspoDetailAfterReceive(
  qc: QueryClient,
  cspoId: string,
  receiveSession: ReceiveSession,
) {
  const packages = receiveSession.packages;
  const receivedCount = packages.filter((p) => p.received).length;
  const pendingReceipts = packages.filter((p) => !p.received).length;
  const cspoStatus =
    typeof receiveSession.cspo.status === "string" ? receiveSession.cspo.status : "in_transit";

  patchCspoStatus(qc, cspoId, cspoStatus);
  patchCspoDetailWorkflow(qc, cspoId, {
    pending_receipts: pendingReceipts,
    received_packages: receivedCount,
    total_packages: packages.length,
    units_aboard: receiveSession.items_on_vessel,
  });
}

/** Sync CSPO detail after packing is marked complete. */
export function patchCspoDetailAfterPackingComplete(qc: QueryClient, cspoId: string) {
  const pack = qc.getQueryData<PackSession>(["pack-session", cspoId]);
  const totalPackages = pack?.packages.length ?? 0;

  patchCspoStatus(qc, cspoId, "in_transit");
  patchCspoDetailWorkflow(qc, cspoId, {
    list_status: pack?.list.status ?? "complete",
    pending_receipts: totalPackages,
    received_packages: 0,
    total_packages: totalPackages,
  });
}

/** Adjust aboard/blocker counts when inventory changes on hot paths. */
export function patchCspoDetailFromAboardInventory(
  qc: QueryClient,
  cspoId: string,
  unitsAboard: number,
  skuCountAboard: number,
) {
  const prev = workflowSnapshot(qc, cspoId);
  const prevUnits = prev?.units_aboard ?? 0;
  const delta = prevUnits - unitsAboard;

  patchCspoDetailWorkflow(qc, cspoId, {
    units_aboard: unitsAboard,
    sku_count_aboard: skuCountAboard,
    blocker_count: Math.max(0, (prev?.blocker_count ?? prevUnits) - delta),
  });

  patchCspoStatusIfAboardCleared(qc, cspoId, unitsAboard);
}

/** Drop on_vessel → in_progress once nothing is left aboard the ship. */
export function patchCspoStatusIfAboardCleared(
  qc: QueryClient,
  cspoId: string,
  unitsAboard?: number,
) {
  const wf = workflowSnapshot(qc, cspoId);
  const aboard = unitsAboard ?? wf?.units_aboard ?? 0;
  if (aboard > 0) return;

  const detail = qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId]);
  const listRow = qc
    .getQueryData<CspoRow[]>(CSPO_LIST_QUERY_KEY)
    ?.find((c) => c.id === cspoId);
  const status = detail?.cspo.status ?? listRow?.status;

  if (status === "on_vessel") {
    patchCspoStatus(qc, cspoId, "in_progress");
  }
}

/** Sync detail status + workflow after sealed returns or warehouse restock. */
export function patchCspoDetailAfterAboardInventoryChange(
  qc: QueryClient,
  cspoId: string,
  removedCount: number,
) {
  const wf = workflowSnapshot(qc, cspoId);
  const newAboard = Math.max(0, (wf?.units_aboard ?? 0) - removedCount);
  const newBlockers = Math.max(0, (wf?.blocker_count ?? wf?.units_aboard ?? 0) - removedCount);

  patchCspoDetailWorkflow(qc, cspoId, {
    units_aboard: newAboard,
    blocker_count: newBlockers,
  });
  patchCspoStatusIfAboardCleared(qc, cspoId, newAboard);
}
