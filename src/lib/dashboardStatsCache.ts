import type { QueryClient } from "@tanstack/react-query";
import {
  DASHBOARD_STATS_QUERY_KEY,
  type DashboardStats,
} from "@/hooks/useDashboardStats";
import {
  CSPO_DETAIL_SESSION_QUERY_KEY,
  type CspoDetailSession,
  type CspoRow,
} from "@/hooks/useCspos";
import type { ReceiveSession } from "@/hooks/useOnboard";
import { CSPO_FINANCIAL_QUERY_KEY } from "@/lib/cspoFinancial";
import { CSPO_LIST_QUERY_KEY } from "@/lib/cspoListCache";

const VALUE_AT_SEA_STATUSES = new Set(["on_vessel", "in_progress", "closing"]);
const CLOSED_CSPO_STATUSES = new Set(["closed", "cancelled"]);

export function cspoCountsTowardValueAtSea(status: string | undefined): boolean {
  return !!status && VALUE_AT_SEA_STATUSES.has(status);
}

function isOpenCspoStatus(status: string): boolean {
  return !CLOSED_CSPO_STATUSES.has(status);
}

function countOpenCsposOnVessel(qc: QueryClient, vesselId: string): number {
  return (qc.getQueryData<CspoRow[]>(CSPO_LIST_QUERY_KEY) ?? []).filter(
    (row) => row.vessel?.id === vesselId && isOpenCspoStatus(row.status),
  ).length;
}

function readCspoStatus(qc: QueryClient, cspoId: string): string | undefined {
  return (
    qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId])?.cspo.status ??
    qc.getQueryData<ReceiveSession>(["receive-session", cspoId])?.cspo.status ??
    qc.getQueryData<CspoRow[]>(CSPO_LIST_QUERY_KEY)?.find((row) => row.id === cspoId)?.status
  );
}

function readCspoOpenBalance(qc: QueryClient, cspoId: string): number {
  const financial =
    qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId])?.financial ??
    qc.getQueryData<CspoDetailSession["financial"]>([CSPO_FINANCIAL_QUERY_KEY, cspoId]);
  return Number(financial?.summary.open_balance ?? 0);
}

export function patchDashboardStatDelta(
  qc: QueryClient,
  field: keyof DashboardStats,
  delta: number,
) {
  qc.setQueryData<DashboardStats>(DASHBOARD_STATS_QUERY_KEY, (old) => {
    if (!old) return old;
    return { ...old, [field]: Math.max(0, old[field] + delta) };
  });
}

/** New CSPO created (counts toward open CSPOs). */
export function patchDashboardAfterCspoCreated(qc: QueryClient, vesselId?: string | null) {
  patchDashboardStatDelta(qc, "openCspos", 1);
  if (vesselId && countOpenCsposOnVessel(qc, vesselId) === 0) {
    patchDashboardStatDelta(qc, "vesselsUnderService", 1);
  }
}

/** CSPO closed or cancelled. */
export function patchDashboardAfterCspoClosed(
  qc: QueryClient,
  opts?: {
    openBalance?: number;
    wasAtSea?: boolean;
    vesselId?: string | null;
  },
) {
  patchDashboardStatDelta(qc, "openCspos", -1);
  if (opts?.wasAtSea) {
    const open = opts.openBalance ?? 0;
    if (open > 0) patchDashboardValueAtSeaDelta(qc, -open);
  }
  if (opts?.vesselId && countOpenCsposOnVessel(qc, opts.vesselId) === 0) {
    patchDashboardStatDelta(qc, "vesselsUnderService", -1);
  }
}

/** Material list submitted — job enters warehouse packing queue. */
export function patchDashboardAfterListSubmitted(qc: QueryClient) {
  patchDashboardStatDelta(qc, "packingQueue", 1);
}

/** Packing marked complete — shipment in transit. */
export function patchDashboardAfterPackingComplete(qc: QueryClient) {
  patchDashboardStatDelta(qc, "packingQueue", -1);
  patchDashboardStatDelta(qc, "todaysDeliveries", 1);
}

/** Procurement request opened or fully received. */
export function patchDashboardProcurementDelta(qc: QueryClient, delta: number) {
  patchDashboardStatDelta(qc, "procurementQueue", delta);
}

/** Value moved onto or off active aboard CSPOs. */
export function patchDashboardValueAtSeaDelta(qc: QueryClient, delta: number) {
  qc.setQueryData<DashboardStats>(DASHBOARD_STATS_QUERY_KEY, (old) => {
    if (!old) return old;
    return { ...old, valueAtSea: Math.max(0, old.valueAtSea + delta) };
  });
}

/** Ledger entries changed open balance on an aboard CSPO. */
export function patchDashboardValueAtSeaFromLedger(
  qc: QueryClient,
  cspoId: string,
  ledgerEntries: Array<{ amount: number }>,
) {
  if (ledgerEntries.length === 0) return;
  if (!cspoCountsTowardValueAtSea(readCspoStatus(qc, cspoId))) return;
  const delta = ledgerEntries.reduce((sum, row) => sum + Number(row.amount), 0);
  if (delta !== 0) patchDashboardValueAtSeaDelta(qc, delta);
}

/** CSPO finished transit and now counts toward value at sea. */
export function patchDashboardValueAtSeaAfterAboard(qc: QueryClient, cspoId: string) {
  if (!cspoCountsTowardValueAtSea(readCspoStatus(qc, cspoId))) return;
  const open = readCspoOpenBalance(qc, cspoId);
  if (open > 0) patchDashboardValueAtSeaDelta(qc, open);
}

export function patchDashboardAfterAllPackagesReceived(qc: QueryClient) {
  patchDashboardStatDelta(qc, "todaysDeliveries", -1);
}
