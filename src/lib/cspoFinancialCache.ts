import type { QueryClient } from "@tanstack/react-query";
import {
  CSPO_DETAIL_SESSION_QUERY_KEY,
  type CspoDetailSession,
} from "@/hooks/useCspos";
import type { OnboardSkuInventoryRow, ReturnsSession, UsageLogSession } from "@/hooks/useOnboard";
import {
  buildFinancialSummary,
  CSPO_FINANCIAL_QUERY_KEY,
  type LedgerEntryRow,
} from "@/lib/cspoFinancial";
import { patchDashboardValueAtSeaFromLedger } from "@/lib/dashboardStatsCache";
import { patchCspoPnlFromLedgerEntries } from "@/lib/reportsCache";

export type LedgerAmountRow = {
  entry_type: string;
  amount: number;
  sku_code?: string | null;
  sku_name?: string | null;
};

type FinancialCache = CspoDetailSession["financial"];

function setFinancialCache(
  qc: QueryClient,
  cspoId: string,
  updater: (old: FinancialCache | undefined) => FinancialCache | undefined,
) {
  qc.setQueryData<FinancialCache>([CSPO_FINANCIAL_QUERY_KEY, cspoId], updater);
  qc.setQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId], (old) => {
    if (!old) return old;
    const financial = updater(old.financial);
    if (!financial) return old;
    return { ...old, financial };
  });
}

function getInventory(qc: QueryClient, cspoId: string): OnboardSkuInventoryRow[] | undefined {
  return (
    qc.getQueryData<OnboardSkuInventoryRow[]>(["onboard-sku-inventory", cspoId]) ??
    qc.getQueryData<UsageLogSession>(["usage-log-session", cspoId])?.inventory ??
    qc.getQueryData<ReturnsSession>(["returns-session", cspoId])?.inventory
  );
}

function itemsOnVesselCount(qc: QueryClient, cspoId: string) {
  const inventory = getInventory(qc, cspoId);
  if (inventory) {
    return inventory.reduce((sum, row) => sum + row.aboard, 0);
  }
  return (
    qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId])?.workflow
      .units_aboard ??
    qc.getQueryData<FinancialCache>([CSPO_FINANCIAL_QUERY_KEY, cspoId])?.summary
      .items_on_vessel ??
    0
  );
}

function actionTypeToLedgerEntry(actionType: "consumed" | "installed" | "damaged") {
  if (actionType === "damaged") return "written_off";
  return actionType;
}

function estimateLedgerAmount(
  entries: LedgerEntryRow[],
  entryType: string,
  skuCode: string,
): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const row = entries[i];
    if (row.entry_type === entryType && row.material_instance?.sku?.sku_code === skuCode) {
      return Number(row.amount);
    }
  }
  return 0;
}

function resolveLedgerAmounts(
  entries: LedgerEntryRow[],
  ledgerEntries: LedgerAmountRow[] | undefined,
  fallback: {
    qty: number;
    entryType: string;
    skuCode: string;
  },
): LedgerAmountRow[] {
  if (ledgerEntries?.length) {
    return ledgerEntries.map((row) => ({
      entry_type: row.entry_type,
      amount: Number(row.amount),
    }));
  }

  const unitAmount = estimateLedgerAmount(entries, fallback.entryType, fallback.skuCode);
  return Array.from({ length: fallback.qty }, () => ({
    entry_type: fallback.entryType,
    amount: unitAmount,
  }));
}

export function patchFinancialItemsFromInventory(qc: QueryClient, cspoId: string) {
  const items_on_vessel = itemsOnVesselCount(qc, cspoId);

  setFinancialCache(qc, cspoId, (old) => {
    if (!old) return old;
    return {
      ...old,
      summary: { ...old.summary, items_on_vessel },
    };
  });
}

export function patchFinancialAfterLedgerEntries(
  qc: QueryClient,
  cspoId: string,
  ledgerEntries: LedgerAmountRow[],
  display: {
    skuCode: string;
    skuName: string;
    notes?: string | null;
  },
) {
  if (ledgerEntries.length === 0) return;

  patchFinancialLedgerRows(
    qc,
    cspoId,
    ledgerEntries.map((row) => ({
      entry_type: row.entry_type,
      amount: Number(row.amount),
      skuCode: row.sku_code ?? display.skuCode,
      skuName: row.sku_name ?? display.skuName,
      notes: display.notes ?? null,
    })),
  );

  patchCspoPnlFromLedgerEntries(
    qc,
    cspoId,
    ledgerEntries.map((row) => ({
      entry_type: row.entry_type,
      amount: Number(row.amount),
    })),
  );

  patchDashboardValueAtSeaFromLedger(qc, cspoId, ledgerEntries);
}

export function patchFinancialLedgerRows(
  qc: QueryClient,
  cspoId: string,
  rows: Array<{
    entry_type: string;
    amount: number;
    skuCode: string;
    skuName: string;
    notes?: string | null;
  }>,
) {
  if (rows.length === 0) return;

  const items_on_vessel = itemsOnVesselCount(qc, cspoId);

  setFinancialCache(qc, cspoId, (old) => {
    if (!old) return old;

    const now = new Date().toISOString();
    const optimisticEntries: LedgerEntryRow[] = rows.map((row) => ({
      id: `optimistic-${crypto.randomUUID()}`,
      entry_type: row.entry_type,
      amount: Number(row.amount),
      notes: row.notes ?? null,
      occurred_at: now,
      material_instance: {
        sku: { sku_code: row.skuCode, name: row.skuName },
      },
    }));

    const entries = [...old.entries, ...optimisticEntries];
    return {
      summary: buildFinancialSummary(entries, items_on_vessel),
      entries,
    };
  });

  patchCspoPnlFromLedgerEntries(
    qc,
    cspoId,
    rows.map((row) => ({ entry_type: row.entry_type, amount: row.amount })),
  );

  patchDashboardValueAtSeaFromLedger(qc, cspoId, rows);
}

export function patchFinancialAfterClose(
  qc: QueryClient,
  cspoId: string,
  openBalance: number,
) {
  setFinancialCache(qc, cspoId, (old) => {
    if (!old) return old;
    return {
      ...old,
      summary: {
        ...old.summary,
        open_balance: openBalance,
        items_on_vessel: 0,
      },
    };
  });
}

export function patchFinancialAfterUsageLog(
  qc: QueryClient,
  cspoId: string,
  entry: {
    actionType: "consumed" | "installed" | "damaged";
    qty: number;
    skuCode: string;
    skuName: string;
    notes?: string | null;
    location?: string | null;
    ledgerEntries?: LedgerAmountRow[];
  },
) {
  const financial =
    qc.getQueryData<FinancialCache>([CSPO_FINANCIAL_QUERY_KEY, cspoId]) ??
    qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, cspoId])?.financial;
  const entryType = actionTypeToLedgerEntry(entry.actionType);
  const ledgerEntries = resolveLedgerAmounts(financial?.entries ?? [], entry.ledgerEntries, {
    qty: entry.qty,
    entryType,
    skuCode: entry.skuCode,
  });

  patchFinancialAfterLedgerEntries(qc, cspoId, ledgerEntries, {
    skuCode: entry.skuCode,
    skuName: entry.skuName,
    notes: entry.notes ?? entry.location ?? null,
  });
}
