import type { QueryClient } from "@tanstack/react-query";
import {
  REPORTS_OVERVIEW_QUERY_KEY,
  type BookkeeperPerformanceRow,
  type CspoPnlReportRow,
  type ReportsOverview,
  type TransferAuditRow,
} from "@/hooks/useReports";

const TRANSFER_AUDIT_QUERY_KEY = ["transfer-audit"] as const;

export function patchReportsOverviewDelta(
  qc: QueryClient,
  field: keyof ReportsOverview,
  delta: number,
) {
  qc.setQueryData<ReportsOverview>(REPORTS_OVERVIEW_QUERY_KEY, (old) => {
    if (!old) return old;
    return { ...old, [field]: Math.max(0, old[field] + delta) };
  });
}

export function patchCspoPnlReportRow(
  qc: QueryClient,
  cspoId: string,
  patch: Partial<CspoPnlReportRow>,
) {
  qc.setQueryData<CspoPnlReportRow[]>(["cspo-pnl-report"], (old) => {
    if (!old) return old;
    return old.map((row) =>
      row.cspo_id === cspoId ? { ...row, ...patch } : row,
    );
  });
}

export function buildCspoPnlRowFromCreate(row: {
  id: string;
  cspo_number: string;
  status: string;
  original_value: number;
  currency: string;
}): CspoPnlReportRow {
  return {
    cspo_id: row.id,
    cspo_number: row.cspo_number,
    status: row.status,
    original_value: row.original_value,
    consumed_value: 0,
    installed_value: 0,
    returned_value: 0,
    transferred_out_value: 0,
    open_balance: row.original_value,
    variance_pct: 100,
    currency: row.currency,
  };
}

export function patchCspoPnlReportPrepend(qc: QueryClient, row: CspoPnlReportRow) {
  qc.setQueryData<CspoPnlReportRow[]>(["cspo-pnl-report"], (old) => {
    if (!old) return old;
    if (old.some((existing) => existing.cspo_id === row.cspo_id)) return old;
    return [...old, row].sort((a, b) => a.cspo_number.localeCompare(b.cspo_number));
  });
}

export function patchBookkeeperReportAfterClose(
  qc: QueryClient,
  bookkeeperId: string,
  opts?: { openBalanceDelta?: number },
) {
  qc.setQueryData<BookkeeperPerformanceRow[]>(["report-bookkeeper"], (old) => {
    if (!old) return old;
    return old.map((row) =>
      row.bookkeeper_id === bookkeeperId
        ? {
            ...row,
            closed_count: row.closed_count + 1,
            total_open_balance: Math.max(
              0,
              row.total_open_balance + (opts?.openBalanceDelta ?? 0),
            ),
          }
        : row,
    );
  });
}

export function patchCspoPnlFromLedgerEntries(
  qc: QueryClient,
  cspoId: string,
  ledgerEntries: Array<{ entry_type: string; amount: number }>,
) {
  if (ledgerEntries.length === 0) return;

  qc.setQueryData<CspoPnlReportRow[]>(["cspo-pnl-report"], (old) => {
    if (!old) return old;
    return old.map((row) => {
      if (row.cspo_id !== cspoId) return row;

      let consumed = Number(row.consumed_value);
      let installed = Number(row.installed_value);
      let returned = Number(row.returned_value);
      let xferOut = Number(row.transferred_out_value);
      let open = Number(row.open_balance);

      for (const entry of ledgerEntries) {
        const amt = Number(entry.amount);
        open += amt;
        switch (entry.entry_type) {
          case "consumed":
            consumed += -amt;
            break;
          case "installed":
            installed += -amt;
            break;
          case "returned":
            returned += -amt;
            break;
          case "transferred_out":
            xferOut += -amt;
            break;
          case "written_off":
            consumed += -amt;
            break;
        }
      }

      const original = Number(row.original_value);
      const variance_pct =
        original > 0 ? Math.round((open / original) * 1000) / 10 : Number(row.variance_pct);

      return {
        ...row,
        consumed_value: consumed,
        installed_value: installed,
        returned_value: returned,
        transferred_out_value: xferOut,
        open_balance: open,
        variance_pct,
      };
    });
  });
}

export function patchTransferAuditPrepend(
  qc: QueryClient,
  rows: TransferAuditRow[],
) {
  if (rows.length === 0) return;

  qc.setQueryData<TransferAuditRow[]>(TRANSFER_AUDIT_QUERY_KEY, (old) => {
    if (!old) return old;
    const existing = new Set(old.map((row) => row.transfer_id));
    const toAdd = rows.filter((row) => !existing.has(row.transfer_id));
    return [...toAdd, ...old].slice(0, 100);
  });
}

export function patchTransferAuditAcknowledged(
  qc: QueryClient,
  transferId: string,
  acknowledgedAt = new Date().toISOString(),
) {
  qc.setQueryData<TransferAuditRow[]>(TRANSFER_AUDIT_QUERY_KEY, (old) => {
    if (!old) return old;
    return old.map((row) =>
      row.transfer_id === transferId
        ? { ...row, acknowledged_at: acknowledgedAt }
        : row,
    );
  });
}
