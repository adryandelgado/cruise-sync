import type { QueryClient } from "@tanstack/react-query";
import type { ReceiveSession, ReturnManifestRow } from "@/hooks/useOnboard";
import { patchCspoDetailAfterAboardInventoryChange } from "@/lib/cspoDetailCache";
import { patchAboardBlockerSideEffects } from "@/lib/closureSessionCache";
import {
  patchFinancialAfterLedgerEntries,
  patchFinancialItemsFromInventory,
  patchFinancialLedgerRows,
  type LedgerAmountRow,
} from "@/lib/cspoFinancialCache";
import {
  patchOnboardInventoryAfterSeal,
  patchOnboardInventoryAfterReceive,
  patchOnboardSkuAfterReturnAdd,
  patchOnboardSkuAfterTransferAck,
  patchOnboardSkuAfterUsage,
  patchReceiveSessionAfterReceive,
  patchReturnManifestAfterAdd,
  patchReturnManifestAfterSeal,
  patchReturnManifestCreate,
  patchCspoWorkflowSummaryFromInventory,
  removeOptimisticReturnManifestItems,
  replaceReturnManifestId,
} from "@/lib/onboardSessionCache";
import type {
  OnboardSkuInventoryRow,
  ReturnsSession,
  UsageLogSession,
} from "@/hooks/useOnboard";
import {
  ONBOARD_HUB_QUERY_KEY,
  patchOnboardHubInventoryTotals,
  patchOnboardHubPendingTransferDelta,
  type OnboardHub,
} from "@/lib/onboardHubCache";
import {
  patchReturnRestockPrependAfterSeal,
  patchReturnRestockRenameManifestId,
} from "@/lib/restockSessionCache";
import {
  findPendingTransferRow,
  findPendingTransferToCspo,
  patchPendingTransfersAfterAck,
  patchPendingTransfersPrepend,
  transferAuditRowToPendingTransfer,
} from "@/lib/pendingTransfersCache";
import { patchReportsOverviewDelta, patchTransferAuditAcknowledged, patchTransferAuditPrepend } from "@/lib/reportsCache";
import type { TransferAuditRow } from "@/hooks/useReports";
import { supabase } from "@/lib/supabase";

export const OFFLINE_MANIFEST_ID_PREFIX = "offline-manifest-";

export function isOfflineManifestId(id: string) {
  return id.startsWith(OFFLINE_MANIFEST_ID_PREFIX);
}

export function createOfflineManifestId() {
  return `${OFFLINE_MANIFEST_ID_PREFIX}${crypto.randomUUID()}`;
}

export type ReceivePackageVars = {
  packageId: string;
  cspoId: string;
  notes?: string;
};

export type ReceivePackagePayload = {
  trackable_added?: number;
  inventory_deltas?: Array<{
    sku_id: string;
    sku_code: string;
    name: string;
    unit_of_measure: string;
    qty_added: number;
  }>;
};

export type ReceivePackageMutationResult = {
  cspoId: string;
  packageId: string;
  result: ReceivePackagePayload;
  queued?: boolean;
};

export async function executeReceivePackageRpc(
  vars: ReceivePackageVars,
): Promise<ReceivePackageMutationResult> {
  const { data, error } = await supabase().rpc("receive_package", {
    p_package_id: vars.packageId,
    p_notes: vars.notes ?? null,
  });
  if (error) throw error;

  return {
    cspoId: vars.cspoId,
    packageId: vars.packageId,
    result: (data ?? {}) as ReceivePackagePayload,
  };
}

export function applyReceivePackageSuccess(
  qc: QueryClient,
  { cspoId, packageId, result }: ReceivePackageMutationResult,
) {
  patchReceiveSessionAfterReceive(qc, cspoId, packageId);

  const deltas = result.inventory_deltas ?? [];
  if (deltas.length > 0) {
    patchOnboardInventoryAfterReceive(qc, cspoId, deltas);
    patchAboardBlockerSideEffects(
      qc,
      cspoId,
      deltas.reduce((sum, row) => sum + row.qty_added, 0),
      deltas.map((row) => ({
        sku_code: row.sku_code,
        name: row.name,
        qty: row.qty_added,
      })),
    );
    return;
  }

  const session = qc.getQueryData<ReceiveSession>(["receive-session", cspoId]);
  const pkg = session?.packages.find((row) => row.id === packageId);
  const trackableAdded = Number(result.trackable_added ?? pkg?.trackable_count ?? 0);
  if (trackableAdded > 0) {
    patchFinancialItemsFromInventory(qc, cspoId);
    patchAboardBlockerSideEffects(qc, cspoId, trackableAdded);
  }
}

export function buildOfflineReceivePackageResult(
  qc: QueryClient,
  vars: ReceivePackageVars,
): ReceivePackageMutationResult {
  const session = qc.getQueryData<ReceiveSession>(["receive-session", vars.cspoId]);
  const pkg = session?.packages.find((row) => row.id === vars.packageId);

  return {
    cspoId: vars.cspoId,
    packageId: vars.packageId,
    result: { trackable_added: pkg?.trackable_count ?? 0 },
    queued: true,
  };
}

export function reconcileReceivePackageReplay(
  qc: QueryClient,
  data: ReceivePackageMutationResult,
) {
  applyReceivePackageSuccess(qc, data);
}

export type AddReturnSkuQtyVars = {
  manifestId: string;
  cspoId: string;
  skuId: string;
  qty?: number;
  condition?: "good" | "damaged" | "needs_inspection";
};

export type AddReturnSkuQtyPayload = {
  added: number;
  on_manifest: number;
};

export type AddReturnSkuQtyMutationResult = {
  manifestId: string;
  cspoId: string;
  skuId: string;
  result: AddReturnSkuQtyPayload;
  queued?: boolean;
};

function inventoryForCspo(qc: QueryClient, cspoId: string) {
  return (
    qc.getQueryData<OnboardSkuInventoryRow[]>(["onboard-sku-inventory", cspoId]) ??
    qc.getQueryData<UsageLogSession>(["usage-log-session", cspoId])?.inventory ??
    qc.getQueryData<ReturnsSession>(["returns-session", cspoId])?.inventory
  );
}

export async function executeAddReturnSkuQtyRpc(
  vars: AddReturnSkuQtyVars,
): Promise<AddReturnSkuQtyMutationResult> {
  const { data, error } = await supabase().rpc("add_return_sku_qty", {
    p_manifest_id: vars.manifestId,
    p_cspo_id: vars.cspoId,
    p_sku_id: vars.skuId,
    p_qty: vars.qty ?? 1,
    p_condition: vars.condition ?? "good",
  });
  if (error) throw error;

  return {
    manifestId: vars.manifestId,
    cspoId: vars.cspoId,
    skuId: vars.skuId,
    result: data as AddReturnSkuQtyPayload,
  };
}

export function applyAddReturnSkuQtySuccess(
  qc: QueryClient,
  vars: AddReturnSkuQtyVars,
  result: AddReturnSkuQtyPayload,
) {
  const inventory = inventoryForCspo(qc, vars.cspoId);
  const skuRow = inventory?.find((row) => row.sku_id === vars.skuId);

  patchOnboardSkuAfterReturnAdd(qc, vars.cspoId, vars.skuId, result.on_manifest);

  if (skuRow) {
    patchReturnManifestAfterAdd(
      qc,
      vars.cspoId,
      vars.manifestId,
      skuRow.sku_code,
      skuRow.name,
      result.added,
    );
  }
}

export function buildOfflineAddReturnSkuQtyResult(
  qc: QueryClient,
  vars: AddReturnSkuQtyVars,
): AddReturnSkuQtyMutationResult {
  const inventory = inventoryForCspo(qc, vars.cspoId);
  const skuRow = inventory?.find((row) => row.sku_id === vars.skuId);
  const qty = vars.qty ?? 1;
  const priorOnManifest = skuRow?.on_manifest ?? 0;

  return {
    manifestId: vars.manifestId,
    cspoId: vars.cspoId,
    skuId: vars.skuId,
    result: {
      added: qty,
      on_manifest: priorOnManifest + qty,
    },
    queued: true,
  };
}

export function reconcileAddReturnSkuQtyReplay(
  qc: QueryClient,
  vars: AddReturnSkuQtyVars,
  result: AddReturnSkuQtyPayload,
) {
  removeOptimisticReturnManifestItems(qc, vars.cspoId, vars.manifestId);
  applyAddReturnSkuQtySuccess(qc, vars, result);
}

export type InitiateTransferSkuQtyVars = {
  cspoId: string;
  skuId: string;
  toCspoId: string;
  qty?: number;
  notes?: string;
};

export type InitiateTransferSkuQtyPayload = {
  transferred: number;
  remaining_on_vessel: number;
  ledger_entries?: LedgerAmountRow[];
  transfer_rows?: TransferAuditRow[];
};

export type InitiateTransferSkuQtyMutationResult = {
  cspoId: string;
  toCspoId: string;
  skuId: string;
  result: InitiateTransferSkuQtyPayload;
  queued?: boolean;
};

export async function executeInitiateTransferSkuQtyRpc(
  vars: InitiateTransferSkuQtyVars,
): Promise<InitiateTransferSkuQtyMutationResult> {
  const { data, error } = await supabase().rpc("initiate_transfer_sku_qty", {
    p_cspo_id: vars.cspoId,
    p_sku_id: vars.skuId,
    p_to_cspo_id: vars.toCspoId,
    p_qty: vars.qty ?? 1,
    p_notes: vars.notes ?? null,
  });
  if (error) throw error;

  return {
    cspoId: vars.cspoId,
    toCspoId: vars.toCspoId,
    skuId: vars.skuId,
    result: data as InitiateTransferSkuQtyPayload,
  };
}

export function applyInitiateTransferSkuQtySuccess(
  qc: QueryClient,
  { cspoId, toCspoId, skuId, result }: InitiateTransferSkuQtyMutationResult,
) {
  const inventory = inventoryForCspo(qc, cspoId);
  const skuRow = inventory?.find((row) => row.sku_id === skuId);

  patchOnboardSkuAfterUsage(qc, cspoId, skuId, result.remaining_on_vessel);
  patchCspoWorkflowSummaryFromInventory(qc, cspoId);

  if (skuRow) {
    patchFinancialAfterLedgerEntries(qc, cspoId, result.ledger_entries ?? [], {
      skuCode: skuRow.sku_code,
      skuName: skuRow.name,
      notes: "Transfer initiated",
    });
    patchAboardBlockerSideEffects(qc, cspoId, -result.transferred, [{
      sku_code: skuRow.sku_code,
      name: skuRow.name,
      qty: -result.transferred,
    }]);
  } else {
    patchFinancialItemsFromInventory(qc, cspoId);
    patchAboardBlockerSideEffects(qc, cspoId, -result.transferred);
  }

  patchOnboardHubPendingTransferDelta(qc, toCspoId, 1);
  patchReportsOverviewDelta(qc, "transferCount", result.transferred);

  const transferRows = result.transfer_rows ?? [];
  if (transferRows.length > 0) {
    patchTransferAuditPrepend(qc, transferRows);
    patchPendingTransfersPrepend(
      qc,
      toCspoId,
      cspoId,
      transferRows.map((row) => transferAuditRowToPendingTransfer(row, toCspoId)),
    );
  }
}

export function buildOfflineInitiateTransferSkuQtyResult(
  qc: QueryClient,
  vars: InitiateTransferSkuQtyVars,
): InitiateTransferSkuQtyMutationResult {
  const inventory = inventoryForCspo(qc, vars.cspoId);
  const skuRow = inventory?.find((row) => row.sku_id === vars.skuId);
  const qty = vars.qty ?? 1;
  const remaining = Math.max(0, (skuRow?.aboard ?? 0) - qty);

  return {
    cspoId: vars.cspoId,
    toCspoId: vars.toCspoId,
    skuId: vars.skuId,
    result: {
      transferred: qty,
      remaining_on_vessel: remaining,
    },
    queued: true,
  };
}

export function reconcileInitiateTransferSkuQtyReplay(
  qc: QueryClient,
  data: InitiateTransferSkuQtyMutationResult,
) {
  applyInitiateTransferSkuQtySuccess(qc, data);
}

export type CreateReturnManifestVars = {
  cspoId: string;
};

export type CreateReturnManifestMutationResult = {
  cspoId: string;
  manifestId: string;
  queued?: boolean;
  optimisticManifestId?: string;
};

export async function executeCreateReturnManifestRpc(
  cspoId: string,
): Promise<string> {
  const { data, error } = await supabase().rpc("create_return_manifest", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;
  return data as string;
}

export function applyCreateReturnManifestSuccess(
  qc: QueryClient,
  cspoId: string,
  manifestId: string,
) {
  patchReturnManifestCreate(qc, cspoId, manifestId);
}

export function buildOfflineCreateReturnManifestResult(
  cspoId: string,
  optimisticManifestId: string,
): CreateReturnManifestMutationResult {
  return {
    cspoId,
    manifestId: optimisticManifestId,
    optimisticManifestId,
    queued: true,
  };
}

export function reconcileCreateReturnManifestReplay(
  qc: QueryClient,
  cspoId: string,
  optimisticManifestId: string | undefined,
  realManifestId: string,
  remapManifestId: (fromId: string, toId: string) => void,
) {
  if (optimisticManifestId && optimisticManifestId !== realManifestId) {
    replaceReturnManifestId(qc, cspoId, optimisticManifestId, realManifestId);
    patchReturnRestockRenameManifestId(qc, optimisticManifestId, realManifestId);
    remapManifestId(optimisticManifestId, realManifestId);
    return;
  }

  applyCreateReturnManifestSuccess(qc, cspoId, realManifestId);
}

export type SealReturnManifestVars = {
  manifestId: string;
  cspoId: string;
  freight?: string;
};

export type SealReturnManifestPayload = {
  sealed?: boolean;
  item_count?: number;
  ledger_entries?: LedgerAmountRow[];
};

export type SealReturnManifestMutationResult = {
  cspoId: string;
  manifestId: string;
  freight?: string;
  ledgerEntries?: LedgerAmountRow[];
  queued?: boolean;
};

function returnManifestForCspo(qc: QueryClient, cspoId: string) {
  return (
    qc.getQueryData<ReturnsSession>(["returns-session", cspoId])?.manifest ??
    qc.getQueryData<ReturnManifestRow | null>(["return-manifest", cspoId])
  );
}

export async function executeSealReturnManifestRpc(
  vars: SealReturnManifestVars,
): Promise<SealReturnManifestMutationResult> {
  const { data, error } = await supabase().rpc("seal_return_manifest", {
    p_manifest_id: vars.manifestId,
    p_freight: vars.freight ?? null,
  });
  if (error) throw error;

  const payload = (data ?? {}) as SealReturnManifestPayload;
  return {
    cspoId: vars.cspoId,
    manifestId: vars.manifestId,
    freight: vars.freight,
    ledgerEntries: payload.ledger_entries,
  };
}

export function applySealReturnManifestSuccess(
  qc: QueryClient,
  { cspoId, manifestId, freight, ledgerEntries }: SealReturnManifestMutationResult,
  manifestItems?: ReturnManifestRow["items"],
) {
  const manifest =
    manifestItems != null
      ? ({
          id: manifestId,
          status: "draft",
          freight_company: null,
          created_at: new Date().toISOString(),
          items: manifestItems,
        } satisfies ReturnManifestRow)
      : returnManifestForCspo(qc, cspoId);
  const sealedCount = ledgerEntries?.length ?? manifest?.items.length ?? 0;

  if (manifest?.items.length) {
    patchOnboardInventoryAfterSeal(qc, cspoId, manifest.items);
  }

  patchReturnManifestAfterSeal(qc, cspoId);

  if (sealedCount > 0) {
    patchCspoDetailAfterAboardInventoryChange(qc, cspoId, sealedCount);
    const hub = qc.getQueryData<OnboardHub>(ONBOARD_HUB_QUERY_KEY);
    const job = hub?.jobs.find((row) => row.cspo_id === cspoId);
    if (job) {
      const itemsOnVessel = Math.max(0, job.items_on_vessel - sealedCount);
      patchOnboardHubInventoryTotals(
        qc,
        cspoId,
        itemsOnVessel,
        itemsOnVessel === 0 && job.status === "on_vessel" ? "in_progress" : job.status,
      );
    }
    if (ledgerEntries?.length) {
      patchFinancialLedgerRows(
        qc,
        cspoId,
        ledgerEntries.map((row) => ({
          entry_type: row.entry_type,
          amount: Number(row.amount),
          skuCode: row.sku_code ?? "—",
          skuName: row.sku_name ?? "Item",
          notes: "Return manifest sealed",
        })),
      );
    }

    const sealGroups = new Map<string, { sku_code: string; name: string; qty: number }>();
    for (const item of manifest?.items ?? []) {
      const sku = item.material_instance?.sku;
      if (!sku) continue;
      const prev = sealGroups.get(sku.sku_code);
      sealGroups.set(sku.sku_code, {
        sku_code: sku.sku_code,
        name: sku.name,
        qty: (prev?.qty ?? 0) + 1,
      });
    }
    patchAboardBlockerSideEffects(
      qc,
      cspoId,
      -sealedCount,
      [...sealGroups.values()].map((group) => ({
        sku_code: group.sku_code,
        name: group.name,
        qty: -group.qty,
      })),
    );

    if (manifest?.items.length) {
      patchReturnRestockPrependAfterSeal(qc, {
        manifestId,
        cspoId,
        freight,
        items: manifest.items,
      });
    }
  }
}

export function buildOfflineSealReturnManifestResult(
  vars: SealReturnManifestVars,
): SealReturnManifestMutationResult {
  return {
    cspoId: vars.cspoId,
    manifestId: vars.manifestId,
    freight: vars.freight,
    queued: true,
  };
}

export function reconcileSealReturnManifestReplay(
  qc: QueryClient,
  vars: SealReturnManifestVars,
  result: SealReturnManifestMutationResult,
  manifestItemsSnapshot?: ReturnManifestRow["items"],
  restockManifestId?: string,
) {
  const cachedManifest = returnManifestForCspo(qc, vars.cspoId);
  const snapshot = manifestItemsSnapshot ?? cachedManifest?.items;

  if (!cachedManifest && snapshot?.length) {
    if (restockManifestId && restockManifestId !== vars.manifestId) {
      patchReturnRestockRenameManifestId(qc, restockManifestId, vars.manifestId);
    }

    if (result.ledgerEntries?.length) {
      patchFinancialLedgerRows(
        qc,
        vars.cspoId,
        result.ledgerEntries.map((row) => ({
          entry_type: row.entry_type,
          amount: Number(row.amount),
          skuCode: row.sku_code ?? "—",
          skuName: row.sku_name ?? "Item",
          notes: "Return manifest sealed",
        })),
      );
    }

    const jobs = qc.getQueryData<Array<{ manifest_id: string }>>(["return-receipt-jobs"]);
    const hasRestockJob = jobs?.some((row) => row.manifest_id === vars.manifestId);
    if (!hasRestockJob) {
      patchReturnRestockPrependAfterSeal(qc, {
        manifestId: vars.manifestId,
        cspoId: vars.cspoId,
        freight: vars.freight,
        items: snapshot,
      });
    }
    return;
  }

  applySealReturnManifestSuccess(
    qc,
    result,
    snapshot?.length ? snapshot : undefined,
  );
}

export type AcknowledgeTransferVars = {
  transferId: string;
};

export type AcknowledgeTransferPayload = {
  to_cspo_id?: string;
  sku_id?: string;
  sku_code?: string;
  sku_name?: string;
  unit_of_measure?: string;
  transferred_value?: number;
  remaining_on_vessel?: number;
  ledger_entries?: LedgerAmountRow[];
};

export type AcknowledgeTransferMutationResult = {
  transferId: string;
  result: AcknowledgeTransferPayload;
  queued?: boolean;
};

export async function executeAcknowledgeTransferRpc(
  transferId: string,
): Promise<AcknowledgeTransferMutationResult> {
  const { data, error } = await supabase().rpc("acknowledge_transfer", {
    p_transfer_id: transferId,
  });
  if (error) throw error;

  return {
    transferId,
    result: (data ?? {}) as AcknowledgeTransferPayload,
  };
}

export function applyAcknowledgeTransferSuccess(
  qc: QueryClient,
  { transferId, result }: AcknowledgeTransferMutationResult,
) {
  const toCspoId =
    result.to_cspo_id ?? findPendingTransferToCspo(qc, transferId);
  const pendingRow = findPendingTransferRow(qc, transferId);
  patchPendingTransfersAfterAck(qc, transferId);

  const skuCode =
    result.sku_code ?? pendingRow?.material_instance?.sku?.sku_code;
  const skuName =
    result.sku_name ?? pendingRow?.material_instance?.sku?.name;
  const inventory =
    toCspoId
      ? inventoryForCspo(qc, toCspoId)
      : undefined;
  const skuId =
    result.sku_id ??
    (skuCode
      ? inventory?.find((row) => row.sku_code === skuCode)?.sku_id
      : undefined);

  if (toCspoId) {
    patchOnboardHubPendingTransferDelta(qc, toCspoId, -1);
  }

  if (toCspoId && skuId && skuCode && skuName) {
    patchOnboardSkuAfterTransferAck(
      qc,
      toCspoId,
      {
        sku_id: skuId,
        sku_code: skuCode,
        name: skuName,
        unit_of_measure: result.unit_of_measure ?? "ea",
      },
      result.remaining_on_vessel,
    );
    patchFinancialAfterLedgerEntries(
      qc,
      toCspoId,
      result.ledger_entries ?? [{
        entry_type: "transferred_in",
        amount: Number(
          result.transferred_value ?? pendingRow?.transferred_value ?? 0,
        ),
      }],
      {
        skuCode,
        skuName,
        notes: "Transfer acknowledged",
      },
    );
    patchAboardBlockerSideEffects(qc, toCspoId, 1, [{
      sku_code: skuCode,
      name: skuName,
      qty: 1,
    }]);
  } else if (toCspoId && (result.ledger_entries?.length || result.transferred_value != null)) {
    patchFinancialAfterLedgerEntries(
      qc,
      toCspoId,
      result.ledger_entries ?? [{
        entry_type: "transferred_in",
        amount: Number(
          result.transferred_value ?? pendingRow?.transferred_value ?? 0,
        ),
      }],
      {
        skuCode: skuCode ?? "—",
        skuName: skuName ?? "Transfer",
        notes: "Transfer acknowledged",
      },
    );
    patchCspoWorkflowSummaryFromInventory(qc, toCspoId);
  }

  patchTransferAuditAcknowledged(qc, transferId);
}

export function buildOfflineAcknowledgeTransferResult(
  qc: QueryClient,
  transferId: string,
): AcknowledgeTransferMutationResult {
  const pendingRow = findPendingTransferRow(qc, transferId);
  const toCspoId =
    pendingRow?.to_cspo_id ?? findPendingTransferToCspo(qc, transferId);
  const sku = pendingRow?.material_instance?.sku;
  const inventory = toCspoId ? inventoryForCspo(qc, toCspoId) : undefined;
  const skuRow = sku
    ? inventory?.find((row) => row.sku_code === sku.sku_code)
    : undefined;

  return {
    transferId,
    result: {
      to_cspo_id: toCspoId,
      sku_id: skuRow?.sku_id,
      sku_code: sku?.sku_code,
      sku_name: sku?.name,
      unit_of_measure: skuRow?.unit_of_measure ?? "ea",
      transferred_value: pendingRow?.transferred_value,
      remaining_on_vessel: (skuRow?.aboard ?? 0) + 1,
    },
    queued: true,
  };
}

function reconcileAcknowledgeTransferServerTruth(
  qc: QueryClient,
  { transferId, result }: AcknowledgeTransferMutationResult,
) {
  patchTransferAuditAcknowledged(qc, transferId);

  const toCspoId =
    result.to_cspo_id ?? findPendingTransferToCspo(qc, transferId);
  if (!toCspoId) return;

  const skuCode = result.sku_code;
  const skuName = result.sku_name;
  const skuId = result.sku_id;

  if (skuId && skuCode && skuName) {
    patchOnboardSkuAfterTransferAck(
      qc,
      toCspoId,
      {
        sku_id: skuId,
        sku_code: skuCode,
        name: skuName,
        unit_of_measure: result.unit_of_measure ?? "ea",
      },
      result.remaining_on_vessel,
    );
  }

  if (result.ledger_entries?.length || result.transferred_value != null) {
    patchFinancialAfterLedgerEntries(
      qc,
      toCspoId,
      result.ledger_entries ?? [{
        entry_type: "transferred_in",
        amount: Number(result.transferred_value ?? 0),
      }],
      {
        skuCode: skuCode ?? "—",
        skuName: skuName ?? "Transfer",
        notes: "Transfer acknowledged",
      },
    );
  }
}

export function reconcileAcknowledgeTransferReplay(
  qc: QueryClient,
  data: AcknowledgeTransferMutationResult,
) {
  if (!findPendingTransferRow(qc, data.transferId)) {
    reconcileAcknowledgeTransferServerTruth(qc, data);
    return;
  }

  applyAcknowledgeTransferSuccess(qc, data);
}
