import type { QueryClient } from "@tanstack/react-query";

export const PROCUREMENT_HUB_QUERY_KEY = ["procurement-hub"] as const;

export type ProcurementRequestRow = {
  id: string;
  qty_needed: number;
  qty_received: number;
  status: string;
  needed_by: string | null;
  notes: string | null;
  created_at: string;
  sku: { id: string; sku_code: string; name: string } | null;
  cspo: { cspo_number: string } | null;
  supplier: { name: string } | null;
};

export type ProcurementHubSummary = {
  openCount: number;
  pendingUnits: number;
};

export type ProcurementHub = {
  requests: ProcurementRequestRow[];
  summary: ProcurementHubSummary;
};

export type ProcurementHubRpc = {
  requests: ProcurementRequestRow[];
  summary: {
    open_count: number;
    pending_units: number;
  };
};

export function mapProcurementHubFromRpc(payload: ProcurementHubRpc): ProcurementHub {
  const requests = (payload.requests ?? []).map((req) => ({
    ...req,
    qty_needed: Number(req.qty_needed),
    qty_received: Number(req.qty_received),
  }));
  return {
    requests,
    summary: {
      openCount: Number(payload.summary?.open_count ?? requests.length),
      pendingUnits: Number(payload.summary?.pending_units ?? 0),
    },
  };
}

function withSummary(requests: ProcurementRequestRow[]): ProcurementHub {
  return {
    requests,
    summary: {
      openCount: requests.length,
      pendingUnits: requests.reduce(
        (sum, req) => sum + Math.max(0, Number(req.qty_needed) - Number(req.qty_received)),
        0,
      ),
    },
  };
}

export function patchProcurementHubAfterReceive(
  qc: QueryClient,
  requestId: string,
  qtyReceived: number,
  newStatus: string,
) {
  qc.setQueryData<ProcurementHub>(PROCUREMENT_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    const requests = old.requests
      .map((req) => {
        if (req.id !== requestId) return req;
        return {
          ...req,
          qty_received: Number(req.qty_received) + qtyReceived,
          status: newStatus,
        };
      })
      .filter((req) => req.status !== "received" && req.status !== "cancelled");
    return withSummary(requests);
  });
}

export function patchProcurementHubAfterCreate(qc: QueryClient, request: ProcurementRequestRow) {
  qc.setQueryData<ProcurementHub>(PROCUREMENT_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    if (old.requests.some((req) => req.id === request.id)) return old;
    return withSummary([request, ...old.requests]);
  });
}

export function buildProcurementRequestRow(
  id: string,
  input: {
    skuId: string;
    qtyNeeded: number;
    notes?: string;
    sku?: { id: string; sku_code: string; name: string } | null;
    cspoNumber?: string | null;
  },
): ProcurementRequestRow {
  return {
    id,
    qty_needed: input.qtyNeeded,
    qty_received: 0,
    status: "open",
    needed_by: null,
    notes: input.notes ?? null,
    created_at: new Date().toISOString(),
    sku: input.sku ?? {
      id: input.skuId,
      sku_code: input.skuId.slice(0, 8),
      name: "Unknown SKU",
    },
    cspo: input.cspoNumber ? { cspo_number: input.cspoNumber } : null,
    supplier: null,
  };
}
