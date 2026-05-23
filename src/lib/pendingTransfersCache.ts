import type { QueryClient } from "@tanstack/react-query";
import type { ReturnsSession } from "@/hooks/useOnboard";
import type { TransferAuditRow } from "@/hooks/useReports";

export type PendingTransferRow = {
  id: string;
  transferred_value: number;
  currency: string;
  initiated_at: string;
  notes: string | null;
  to_cspo_id: string;
  from_cspo: { cspo_number: string };
  to_cspo: { cspo_number: string };
  material_instance: {
    sku: { sku_code: string; name: string } | null;
  } | null;
};

export type OutboundPendingTransferRow = {
  id: string;
  to_cspo_id: string;
  transferred_value: number;
  currency: string;
  initiated_at: string;
  notes: string | null;
  to_cspo: { cspo_number: string } | null;
  material_instance: {
    sku: { sku_code: string; name: string } | null;
  } | null;
};

export function transferAuditRowToPendingTransfer(
  row: TransferAuditRow,
  toCspoId: string,
): PendingTransferRow {
  return {
    id: row.transfer_id,
    transferred_value: Number(row.transferred_value),
    currency: row.currency,
    initiated_at: row.initiated_at,
    notes: null,
    to_cspo_id: toCspoId,
    from_cspo: { cspo_number: row.from_cspo },
    to_cspo: { cspo_number: row.to_cspo },
    material_instance: {
      sku: { sku_code: row.sku_code, name: row.sku_name },
    },
  };
}

export function patchPendingTransfersPrepend(
  qc: QueryClient,
  toCspoId: string,
  fromCspoId: string,
  rows: PendingTransferRow[],
) {
  if (rows.length === 0) return;

  const prependUnique = (old: PendingTransferRow[] | undefined) => {
    if (!old) return old;
    const existing = new Set(old.map((row) => row.id));
    const toAdd = rows.filter((row) => !existing.has(row.id));
    return toAdd.length > 0 ? [...toAdd, ...old] : old;
  };

  qc.setQueryData<PendingTransferRow[]>(["pending-transfers", "all"], prependUnique);
  qc.setQueryData<PendingTransferRow[]>(["pending-transfers", toCspoId], prependUnique);

  qc.setQueryData<OutboundPendingTransferRow[]>(
    ["pending-transfers", "outbound", fromCspoId],
    (old) => {
      if (!old) return old;
      const existing = new Set(old.map((row) => row.id));
      const toAdd = rows
        .filter((row) => !existing.has(row.id))
        .map((row) => ({
          id: row.id,
          to_cspo_id: row.to_cspo_id,
          transferred_value: row.transferred_value,
          currency: row.currency,
          initiated_at: row.initiated_at,
          notes: row.notes,
          to_cspo: row.to_cspo,
          material_instance: row.material_instance,
        }));
      return toAdd.length > 0 ? [...toAdd, ...old] : old;
    },
  );

  qc.setQueryData<ReturnsSession>(["returns-session", toCspoId], (old) => {
    if (!old) return old;
    const existing = new Set(old.pending_transfers.map((row) => row.id));
    const toAdd = rows.filter((row) => !existing.has(row.id));
    return toAdd.length > 0
      ? { ...old, pending_transfers: [...toAdd, ...old.pending_transfers] }
      : old;
  });
}

export function patchPendingTransfersAfterAck(qc: QueryClient, transferId: string) {
  qc.setQueriesData<PendingTransferRow[]>(
    { queryKey: ["pending-transfers"] },
    (old) => {
      if (!old) return old;
      return old.filter((row) => row.id !== transferId);
    },
  );
  qc.setQueriesData<ReturnsSession>({ queryKey: ["returns-session"] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pending_transfers: old.pending_transfers.filter((row) => row.id !== transferId),
    };
  });
}

export function findPendingTransferRow(
  qc: QueryClient,
  transferId: string,
): PendingTransferRow | undefined {
  const queries = qc.getQueriesData<PendingTransferRow[]>({ queryKey: ["pending-transfers"] });
  for (const [, data] of queries) {
    const row = data?.find((t) => t.id === transferId);
    if (row) return row;
  }
  const sessionQueries = qc.getQueriesData<ReturnsSession>({ queryKey: ["returns-session"] });
  for (const [, data] of sessionQueries) {
    const row = data?.pending_transfers.find((t) => t.id === transferId);
    if (row) return row;
  }
  return undefined;
}

export function findPendingTransferToCspo(
  qc: QueryClient,
  transferId: string,
): string | undefined {
  const queries = qc.getQueriesData<PendingTransferRow[]>({ queryKey: ["pending-transfers"] });
  for (const [, data] of queries) {
    const row = data?.find((t) => t.id === transferId);
    if (row?.to_cspo_id) return row.to_cspo_id;
  }
  const sessionQueries = qc.getQueriesData<ReturnsSession>({ queryKey: ["returns-session"] });
  for (const [, data] of sessionQueries) {
    const row = data?.pending_transfers.find((t) => t.id === transferId);
    if (row?.to_cspo_id) return row.to_cspo_id;
  }
  return undefined;
}
