import type { QueryClient } from "@tanstack/react-query";
import type { CspoBlockingSummary } from "@/hooks/useClosure";

export type BlockingSkuDelta = {
  sku_code: string;
  name: string;
  qty: number;
};

export function patchBlockingInventoryDelta(
  qc: QueryClient,
  cspoId: string,
  delta: number,
  groups?: BlockingSkuDelta[],
) {
  qc.setQueryData<CspoBlockingSummary>(["cspo-blocking-inventory", cspoId], (old) => {
    if (!old) return old;

    let nextGroups = [...old.groups];
    if (groups) {
      for (const group of groups) {
        const idx = nextGroups.findIndex((row) => row.sku_code === group.sku_code);
        if (idx >= 0) {
          const qty = Math.max(0, nextGroups[idx].qty + group.qty);
          if (qty === 0) {
            nextGroups.splice(idx, 1);
          } else {
            nextGroups[idx] = { ...nextGroups[idx], qty };
          }
        } else if (group.qty > 0) {
          nextGroups.push({
            sku_code: group.sku_code,
            name: group.name,
            qty: group.qty,
            statuses: ["on_vessel"],
          });
        }
      }
      nextGroups.sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      blocker_count: Math.max(0, old.blocker_count + delta),
      groups: nextGroups,
    };
  });
}

export function patchClosureReportAboardDelta(
  qc: QueryClient,
  cspoId: string,
  delta: number,
) {
  qc.setQueryData<Record<string, unknown>>(["closure-report", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      items_still_aboard: Math.max(0, Number(old.items_still_aboard ?? 0) + delta),
    };
  });
}

export function patchAboardBlockerSideEffects(
  qc: QueryClient,
  cspoId: string,
  delta: number,
  groups?: BlockingSkuDelta[],
) {
  if (delta === 0) return;
  patchBlockingInventoryDelta(qc, cspoId, delta, groups);
  patchClosureReportAboardDelta(qc, cspoId, delta);
}

export function patchBlockingInventoryAfterClose(qc: QueryClient, cspoId: string) {
  qc.setQueryData<CspoBlockingSummary>(["cspo-blocking-inventory", cspoId], {
    blocker_count: 0,
    groups: [],
  });
}

export function patchClosureReportAfterClose(
  qc: QueryClient,
  cspoId: string,
  data: { open_balance: number; variance_pct: number },
) {
  qc.setQueryData<Record<string, unknown>>(["closure-report", cspoId], (old) => {
    const base = old ?? { cspo_id: cspoId };
    return {
      ...base,
      status: "closed",
      open_balance: data.open_balance,
      variance_pct: data.variance_pct,
      items_still_aboard: 0,
    };
  });
}
