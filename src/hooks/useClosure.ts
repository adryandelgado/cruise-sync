import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyCompleteReturnReceiptSuccess,
  applyReceiveReturnSkuQtySuccess,
  buildOfflineCompleteReturnReceiptResult,
  buildOfflineReceiveReturnSkuQtyResult,
  executeCompleteReturnReceiptRpc,
  executeReceiveReturnSkuQtyRpc,
} from "@/lib/restockOfflineMutations";
import {
  applyCloseCspoSuccess,
  buildOfflineCloseCspoResult,
  executeCloseCspoRpc,
} from "@/lib/closureOfflineMutations";
import {
  patchReturnRestockAfterReceive,
} from "@/lib/restockSessionCache";
import { enqueueOfflineMutation } from "@/lib/offlineMutationQueue";
import { patchInventoryCatalogAfterReceive } from "@/lib/inventoryCatalogCache";
import { patchMaterialInstancesAfterRestockReceive } from "@/lib/materialInstancesCache";
import { supabase } from "@/lib/supabase";

export type ReturnRestockSkuRow = {
  sku_id: string;
  sku_code: string;
  name: string;
  pending: number;
  received: number;
};

export type ReturnRestockJob = {
  manifest_id: string;
  status: string;
  freight_company: string | null;
  created_at: string;
  cspo_id: string;
  cspo_number: string;
  vessel_name: string;
  total_units: number;
  pending_units: number;
  received_units: number;
  skus: ReturnRestockSkuRow[];
};

export async function fetchReturnReceiptJobs(): Promise<ReturnRestockJob[]> {
  const { data, error } = await supabase().rpc("list_return_restock_jobs");
  if (error) throw error;
  return (data ?? []) as ReturnRestockJob[];
}

export function useReturnReceiptJobs() {
  return useQuery({
    queryKey: ["return-receipt-jobs"],
    queryFn: fetchReturnReceiptJobs,
  });
}

export function useReceiveReturnSkuQty() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      manifestId: string;
      skuId: string;
      qty?: number;
      condition?: "good" | "damaged" | "needs_inspection";
    }) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "receive-return-sku-qty",
          payload: vars,
          createdAt: Date.now(),
        });
        return buildOfflineReceiveReturnSkuQtyResult(qc, vars);
      }
      return executeReceiveReturnSkuQtyRpc(vars);
    },
    onSuccess: (data) => {
      applyReceiveReturnSkuQtySuccess(qc, data);
    },
  });
}

export function useReceiveReturnItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      instanceId,
      manifestId,
      condition = "good",
    }: {
      instanceId: string;
      manifestId: string;
      condition?: "good" | "damaged" | "needs_inspection";
    }) => {
      const { data, error } = await supabase().rpc("receive_return_item", {
        p_instance_id: instanceId,
        p_condition: condition,
      });
      if (error) throw error;
      return {
        manifestId,
        ...(data ?? {}),
      } as {
        manifestId: string;
        instance_id: string;
        sku_id: string;
        to_status: string;
      };
    },
    onSuccess: (result) => {
      if (!result.sku_id) return;

      const job = qc
        .getQueryData<ReturnRestockJob[]>(["return-receipt-jobs"])
        ?.find((row) => row.manifest_id === result.manifestId);
      const skuRow = job?.skus.find((row) => row.sku_id === result.sku_id);
      const pending = Math.max(0, (skuRow?.pending ?? job?.pending_units ?? 1) - 1);

      patchReturnRestockAfterReceive(qc, result.manifestId, result.sku_id, {
        received: 1,
        pending,
      });

      if (result.to_status === "in_stock") {
        patchInventoryCatalogAfterReceive(qc, result.sku_id, 1);
      }

      patchMaterialInstancesAfterRestockReceive(
        qc,
        result.sku_id,
        1,
        result.to_status,
      );
    },
  });
}

export function useCompleteReturnReceipt() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (manifestId: string) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "complete-return-receipt",
          payload: { manifestId },
          createdAt: Date.now(),
        });
        return buildOfflineCompleteReturnReceiptResult(manifestId);
      }
      return executeCompleteReturnReceiptRpc(manifestId);
    },
    onSuccess: ({ manifestId }) => {
      applyCompleteReturnReceiptSuccess(qc, manifestId);
    },
  });
}

export type CspoBlockingSummary = {
  blocker_count: number;
  groups: Array<{
    sku_code: string;
    name: string;
    qty: number;
    statuses: string[];
  }>;
};

export type CspoWorkflowSummary = {
  list_status: string | null;
  list_item_count: number;
  total_packages: number;
  received_packages: number;
  pending_receipts: number;
  units_aboard: number;
  sku_count_aboard: number;
  blocker_count: number;
  pending_outbound_transfers: number;
};

export function useCspoWorkflowSummary(cspoId: string, enabled = true) {
  return useQuery({
    queryKey: ["cspo-workflow-summary", cspoId],
    enabled: enabled && !!cspoId,
    queryFn: async () => {
      const { data, error } = await supabase().rpc("get_cspo_workflow_summary", {
        p_cspo_id: cspoId,
      });
      if (error) throw error;
      return data as CspoWorkflowSummary;
    },
  });
}

export function closureReportQueryKey(cspoId: string) {
  return ["closure-report", cspoId] as const;
}

export async function fetchClosureReport(cspoId: string) {
  const { data, error } = await supabase()
    .from("cspo_closure_report")
    .select("*")
    .eq("cspo_id", cspoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function useClosureReport(cspoId: string) {
  return useQuery({
    queryKey: closureReportQueryKey(cspoId),
    queryFn: () => fetchClosureReport(cspoId),
  });
}

export function cspoBlockingInventoryQueryKey(cspoId: string) {
  return ["cspo-blocking-inventory", cspoId] as const;
}

export async function fetchCspoBlockingInventory(cspoId: string) {
  const { data, error } = await supabase().rpc("get_cspo_blocking_summary", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;
  return data as CspoBlockingSummary;
}

export function useCspoBlockingInventory(cspoId: string, enabled = true) {
  return useQuery({
    queryKey: cspoBlockingInventoryQueryKey(cspoId),
    enabled: enabled && !!cspoId,
    retry: false,
    queryFn: () => fetchCspoBlockingInventory(cspoId),
  });
}

export function useCloseCspo() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { cspoId: string; notes?: string }) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "close-cspo",
          payload: vars,
          createdAt: Date.now(),
        });
        return buildOfflineCloseCspoResult(qc, vars);
      }
      return executeCloseCspoRpc(vars);
    },
    onSuccess: (data) => {
      applyCloseCspoSuccess(qc, data);
    },
  });
}

export function useWarehouseLoad() {
  return useQuery({
    queryKey: ["warehouse-load"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("warehouse_load")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
