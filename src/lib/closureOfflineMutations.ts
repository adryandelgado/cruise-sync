import type { QueryClient } from "@tanstack/react-query";
import {
  CSPO_DETAIL_SESSION_QUERY_KEY,
  type CspoDetailSession,
} from "@/hooks/useCspos";
import type { CspoPnlReportRow } from "@/hooks/useReports";
import { patchCspoStatus, patchCspoDetailWorkflow } from "@/lib/cspoDetailCache";
import {
  patchBlockingInventoryAfterClose,
  patchClosureReportAfterClose,
} from "@/lib/closureSessionCache";
import { patchFinancialAfterClose } from "@/lib/cspoFinancialCache";
import {
  cspoCountsTowardValueAtSea,
  patchDashboardAfterCspoClosed,
} from "@/lib/dashboardStatsCache";
import { patchOnboardHubRemoveJob } from "@/lib/onboardHubCache";
import {
  patchBookkeeperReportAfterClose,
  patchCspoPnlReportRow,
} from "@/lib/reportsCache";
import { supabase } from "@/lib/supabase";

export type CloseCspoVars = {
  cspoId: string;
  notes?: string;
};

export type CloseCspoPayload = {
  cspo_id: string;
  cspo_number: string;
  variance_pct: number;
  open_balance: number;
};

export type CloseCspoMutationResult = {
  cspoId: string;
  notes?: string;
  result: CloseCspoPayload;
  queued?: boolean;
};

export async function executeCloseCspoRpc(
  vars: CloseCspoVars,
): Promise<CloseCspoMutationResult> {
  const { data, error } = await supabase().rpc("close_cspo", {
    p_cspo_id: vars.cspoId,
    p_closure_notes: vars.notes ?? null,
  });
  if (error) throw error;

  return {
    cspoId: vars.cspoId,
    notes: vars.notes,
    result: data as CloseCspoPayload,
  };
}

export function applyCloseCspoSuccess(
  qc: QueryClient,
  { cspoId, notes, result }: CloseCspoMutationResult,
) {
  const detail = qc.getQueryData<CspoDetailSession>([
    CSPO_DETAIL_SESSION_QUERY_KEY,
    cspoId,
  ]);
  const wasAtSea = cspoCountsTowardValueAtSea(detail?.cspo.status);
  const openBalance = Number(
    detail?.financial.summary.open_balance ?? result.open_balance ?? 0,
  );
  const vesselId = detail?.cspo.vessel?.id;

  patchCspoStatus(qc, cspoId, "closed", {
    closure_notes: notes ?? null,
  });
  patchCspoPnlReportRow(qc, cspoId, {
    status: "closed",
    variance_pct: result.variance_pct,
    open_balance: result.open_balance,
  });

  const bookkeeperId = detail?.cspo.bookkeeper?.id;
  if (bookkeeperId) {
    const pnlRow = qc
      .getQueryData<CspoPnlReportRow[]>(["cspo-pnl-report"])
      ?.find((row) => row.cspo_id === cspoId);
    patchBookkeeperReportAfterClose(qc, bookkeeperId, {
      openBalanceDelta: -Number(pnlRow?.open_balance ?? result.open_balance ?? 0),
    });
  }

  patchDashboardAfterCspoClosed(qc, { openBalance, wasAtSea, vesselId });
  patchClosureReportAfterClose(qc, cspoId, {
    open_balance: Number(result.open_balance),
    variance_pct: Number(result.variance_pct),
  });
  patchBlockingInventoryAfterClose(qc, cspoId);
  patchCspoDetailWorkflow(qc, cspoId, {
    units_aboard: 0,
    sku_count_aboard: 0,
    blocker_count: 0,
    pending_outbound_transfers: 0,
  });
  patchFinancialAfterClose(qc, cspoId, Number(result.open_balance));
  patchOnboardHubRemoveJob(qc, cspoId);
}

export function buildOfflineCloseCspoResult(
  qc: QueryClient,
  vars: CloseCspoVars,
): CloseCspoMutationResult {
  const detail = qc.getQueryData<CspoDetailSession>([
    CSPO_DETAIL_SESSION_QUERY_KEY,
    vars.cspoId,
  ]);
  const summary = detail?.financial.summary;

  return {
    cspoId: vars.cspoId,
    notes: vars.notes,
    result: {
      cspo_id: vars.cspoId,
      cspo_number: detail?.cspo.cspo_number ?? vars.cspoId.slice(0, 8),
      variance_pct: 0,
      open_balance: Number(summary?.open_balance ?? 0),
    },
    queued: true,
  };
}

export function reconcileCloseCspoReplay(
  qc: QueryClient,
  data: CloseCspoMutationResult,
) {
  const detail = qc.getQueryData<CspoDetailSession>([
    CSPO_DETAIL_SESSION_QUERY_KEY,
    data.cspoId,
  ]);

  if (detail?.cspo.status === "closed") {
    patchCspoPnlReportRow(qc, data.cspoId, {
      status: "closed",
      variance_pct: data.result.variance_pct,
      open_balance: data.result.open_balance,
    });
    patchClosureReportAfterClose(qc, data.cspoId, {
      open_balance: Number(data.result.open_balance),
      variance_pct: Number(data.result.variance_pct),
    });
    patchFinancialAfterClose(qc, data.cspoId, Number(data.result.open_balance));
    return;
  }

  applyCloseCspoSuccess(qc, data);
}
