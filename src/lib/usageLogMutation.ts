import type { QueryClient } from "@tanstack/react-query";
import type {
  OnboardSkuInventoryRow,
  ReturnsSession,
  UsageLogSession,
} from "@/hooks/useOnboard";
import {
  patchFinancialAfterUsageLog,
  patchFinancialItemsFromInventory,
  type LedgerAmountRow,
} from "@/lib/cspoFinancialCache";
import { patchAboardBlockerSideEffects } from "@/lib/closureSessionCache";
import {
  patchCspoWorkflowSummaryFromInventory,
  patchOnboardSkuAfterUsage,
  patchUsageLogsAfterSkuLog,
  removeUsageLogById,
} from "@/lib/onboardSessionCache";
import { supabase } from "@/lib/supabase";

export type LogSkuUsageVars = {
  cspoId: string;
  skuId: string;
  actionType: "consumed" | "installed" | "damaged";
  qty?: number;
  notes?: string;
  location?: string;
};

export type LogSkuUsagePayload = {
  logged: number;
  remaining_on_vessel: number;
  ledger_entries?: LedgerAmountRow[];
};

export type LogSkuUsageMutationResult = {
  cspoId: string;
  skuId: string;
  result: LogSkuUsagePayload;
  queued?: boolean;
  optimisticLogId?: string;
};

function inventoryForCspo(qc: QueryClient, cspoId: string) {
  return (
    qc.getQueryData<OnboardSkuInventoryRow[]>(["onboard-sku-inventory", cspoId]) ??
    qc.getQueryData<UsageLogSession>(["usage-log-session", cspoId])?.inventory ??
    qc.getQueryData<ReturnsSession>(["returns-session", cspoId])?.inventory
  );
}

export async function executeLogSkuUsageRpc(
  vars: LogSkuUsageVars,
): Promise<LogSkuUsageMutationResult> {
  const { data, error } = await supabase().rpc("log_sku_usage_qty", {
    p_cspo_id: vars.cspoId,
    p_sku_id: vars.skuId,
    p_action_type: vars.actionType,
    p_qty: vars.qty ?? 1,
    p_notes: vars.notes ?? null,
    p_location: vars.location ?? null,
  });
  if (error) throw error;

  return {
    cspoId: vars.cspoId,
    skuId: vars.skuId,
    result: data as LogSkuUsagePayload,
  };
}

export function buildOfflineLogSkuUsageResult(
  qc: QueryClient,
  vars: LogSkuUsageVars,
  optimisticLogId: string,
): LogSkuUsageMutationResult {
  const inventory = inventoryForCspo(qc, vars.cspoId);
  const skuRow = inventory?.find((row) => row.sku_id === vars.skuId);
  const qty = vars.qty ?? 1;
  const remaining = Math.max(0, (skuRow?.aboard ?? 0) - qty);

  return {
    cspoId: vars.cspoId,
    skuId: vars.skuId,
    result: {
      logged: qty,
      remaining_on_vessel: remaining,
    },
    queued: true,
    optimisticLogId,
  };
}

export function applyLogSkuUsageSuccess(
  qc: QueryClient,
  vars: LogSkuUsageVars,
  result: LogSkuUsagePayload,
  optimisticLogId?: string,
) {
  const { cspoId, skuId } = vars;
  const inventory = inventoryForCspo(qc, cspoId);
  const skuRow = inventory?.find((row) => row.sku_id === skuId);

  patchOnboardSkuAfterUsage(qc, cspoId, skuId, result.remaining_on_vessel);
  patchCspoWorkflowSummaryFromInventory(qc, cspoId);

  if (skuRow) {
    patchUsageLogsAfterSkuLog(
      qc,
      cspoId,
      {
        skuCode: skuRow.sku_code,
        skuName: skuRow.name,
        actionType: vars.actionType,
        qty: result.logged,
        notes: vars.notes,
        location: vars.location,
      },
      optimisticLogId,
    );
    patchFinancialAfterUsageLog(qc, cspoId, {
      actionType: vars.actionType,
      qty: result.logged,
      skuCode: skuRow.sku_code,
      skuName: skuRow.name,
      notes: vars.notes,
      location: vars.location,
      ledgerEntries: result.ledger_entries,
    });
    patchAboardBlockerSideEffects(qc, cspoId, -result.logged, [{
      sku_code: skuRow.sku_code,
      name: skuRow.name,
      qty: -result.logged,
    }]);
  } else {
    patchFinancialItemsFromInventory(qc, cspoId);
    patchAboardBlockerSideEffects(qc, cspoId, -result.logged);
  }
}

export function reconcileLogSkuUsageReplay(
  qc: QueryClient,
  vars: LogSkuUsageVars,
  result: LogSkuUsagePayload,
  optimisticLogId?: string,
) {
  if (optimisticLogId) {
    removeUsageLogById(qc, vars.cspoId, optimisticLogId);
  }
  applyLogSkuUsageSuccess(qc, vars, result);
}
