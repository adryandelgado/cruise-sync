import type { QueryClient } from "@tanstack/react-query";
import type { CspoRow } from "@/hooks/useCspos";

export const CSPO_LIST_QUERY_KEY = ["cspos"] as const;

export function patchCspoListRow(
  qc: QueryClient,
  cspoId: string,
  patch: Partial<CspoRow>,
) {
  qc.setQueryData<CspoRow[]>(CSPO_LIST_QUERY_KEY, (old) => {
    if (!old) return old;
    return old.map((row) => (row.id === cspoId ? { ...row, ...patch } : row));
  });
}

export function patchCspoListAfterCreate(qc: QueryClient, row: CspoRow) {
  qc.setQueryData<CspoRow[]>(CSPO_LIST_QUERY_KEY, (old) => {
    if (!old) return old;
    if (old.some((existing) => existing.id === row.id)) return old;
    return [row, ...old];
  });
}

/** Normalize PostgREST embed shape (vessel may arrive as object or single-element array). */
export function mapCspoInsertRow(raw: Record<string, unknown>): CspoRow {
  const vesselRaw = raw.vessel as CspoRow["vessel"] | CspoRow["vessel"][] | null | undefined;
  const vessel = Array.isArray(vesselRaw) ? (vesselRaw[0] ?? null) : (vesselRaw ?? null);

  return {
    id: String(raw.id),
    cspo_number: String(raw.cspo_number),
    status: String(raw.status),
    attendance_type: String(raw.attendance_type),
    original_value: Number(raw.original_value),
    currency: String(raw.currency),
    planned_start: (raw.planned_start as string | null) ?? null,
    planned_end: (raw.planned_end as string | null) ?? null,
    created_at: String(raw.created_at),
    vessel,
  };
}
