import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  patchFinancialAfterLedgerEntries,
  patchFinancialAfterUsageLog,
  patchFinancialItemsFromInventory,
  type LedgerAmountRow,
} from "@/lib/cspoFinancialCache";
import { CSPO_DETAIL_SESSION_QUERY_KEY, type CspoDetailSession } from "@/hooks/useCspos";
import {
  patchReportsOverviewDelta,
  patchTransferAuditPrepend,
} from "@/lib/reportsCache";
import {
  mapOnboardHubFromRpc,
  ONBOARD_HUB_QUERY_KEY,
  patchOnboardHubPendingTransferDelta,
  type OnboardHub,
  type OnboardHubRpc,
} from "@/lib/onboardHubCache";
import {
  patchCspoWorkflowSummaryFromInventory,
  patchOnboardSkuAfterReturnAdd,
  patchOnboardSkuAfterUsage,
  patchReturnManifestAfterAddInstance,
  patchUsageLogsAfterSkuLog,
} from "@/lib/onboardSessionCache";
import { patchAboardBlockerSideEffects } from "@/lib/closureSessionCache";
import { enqueueOfflineMutation } from "@/lib/offlineMutationQueue";
import {
  applyAcknowledgeTransferSuccess,
  applyAddReturnSkuQtySuccess,
  applyCreateReturnManifestSuccess,
  applyInitiateTransferSkuQtySuccess,
  applyReceivePackageSuccess,
  applySealReturnManifestSuccess,
  buildOfflineAcknowledgeTransferResult,
  buildOfflineAddReturnSkuQtyResult,
  buildOfflineCreateReturnManifestResult,
  buildOfflineInitiateTransferSkuQtyResult,
  buildOfflineReceivePackageResult,
  buildOfflineSealReturnManifestResult,
  createOfflineManifestId,
  executeAcknowledgeTransferRpc,
  executeAddReturnSkuQtyRpc,
  executeCreateReturnManifestRpc,
  executeInitiateTransferSkuQtyRpc,
  executeReceivePackageRpc,
  executeSealReturnManifestRpc,
} from "@/lib/onboardOfflineMutations";
import {
  applyLogSkuUsageSuccess,
  buildOfflineLogSkuUsageResult,
  executeLogSkuUsageRpc,
} from "@/lib/usageLogMutation";
import {
  patchPendingTransfersPrepend,
} from "@/lib/pendingTransfersCache";
import { supabase } from "@/lib/supabase";

export { canWorkAboard, type OnboardJob } from "@/lib/onboardHubCache";

export async function fetchOnboardHub(): Promise<OnboardHub> {
  const { data, error } = await supabase().rpc("get_onboard_hub");
  if (error) throw error;
  return mapOnboardHubFromRpc(data as OnboardHubRpc);
}

export function useOnboardHub() {
  return useQuery({
    queryKey: ONBOARD_HUB_QUERY_KEY,
    queryFn: fetchOnboardHub,
  });
}

export function useOnboardJobs() {
  const query = useOnboardHub();
  return {
    ...query,
    data: query.data?.jobs,
  };
}

export type ReceiveSession = {
  cspo: {
    id: string;
    cspo_number: string;
    status: string;
    vessel: unknown;
  };
  packages: Array<{
    id: string;
    package_type: string;
    package_number: number;
    status: string;
    received: boolean;
    receipt: {
      received_at: string;
      discrepancy_notes: string | null;
    } | null;
    trackable_count: number;
    custom_count: number;
  }>;
  items_on_vessel: number;
};

export async function fetchReceiveSession(cspoId: string): Promise<ReceiveSession> {
  const { data, error } = await supabase().rpc("get_receive_session", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;

  type RpcPayload = {
    cspo: ReceiveSession["cspo"];
    packages: ReceiveSession["packages"];
    items_on_vessel: number;
  };

  const payload = data as RpcPayload;
  return {
    cspo: payload.cspo,
    packages: payload.packages ?? [],
    items_on_vessel: Number(payload.items_on_vessel ?? 0),
  };
}

export function useReceiveSession(cspoId: string, enabled = true) {
  return useQuery({
    queryKey: ["receive-session", cspoId],
    enabled: enabled && !!cspoId,
    queryFn: () => fetchReceiveSession(cspoId),
  });
}

export function useReceivePackage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      packageId: string;
      cspoId: string;
      notes?: string;
    }) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "receive-package",
          payload: vars,
          createdAt: Date.now(),
        });
        return buildOfflineReceivePackageResult(qc, vars);
      }
      return executeReceivePackageRpc(vars);
    },
    onSuccess: (data) => {
      applyReceivePackageSuccess(qc, data);
    },
  });
}

export type OnboardSkuInventoryRow = {
  sku_id: string;
  sku_code: string;
  name: string;
  unit_of_measure: string;
  aboard: number;
  on_manifest: number;
  available: number;
};

export type UsageLogRow = {
  id: string;
  action_type: string;
  logged_at: string;
  notes: string | null;
  location_on_vessel: string | null;
  qty: number;
  material_instance: {
    sku: { sku_code: string; name: string } | null;
  } | null;
};

export type UsageLogSession = {
  cspo: {
    cspo_number: string;
    vessel: unknown;
  };
  inventory: OnboardSkuInventoryRow[];
  usage_logs: UsageLogRow[];
};

export async function fetchUsageLogSession(cspoId: string): Promise<UsageLogSession> {
  const { data, error } = await supabase().rpc("get_usage_log_session", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;

  type RpcPayload = {
    cspo: UsageLogSession["cspo"];
    inventory: OnboardSkuInventoryRow[];
    usage_logs: UsageLogRow[];
  };

  const payload = data as RpcPayload;
  return {
    cspo: payload.cspo,
    inventory: payload.inventory ?? [],
    usage_logs: payload.usage_logs ?? [],
  };
}

export function useUsageLogSession(cspoId: string, enabled = true) {
  return useQuery({
    queryKey: ["usage-log-session", cspoId],
    enabled: enabled && !!cspoId,
    queryFn: () => fetchUsageLogSession(cspoId),
  });
}

export type ReturnManifestRow = {
  id: string;
  status: string;
  freight_company: string | null;
  created_at: string;
  items: Array<{
    id: string;
    condition: string;
    material_instance: {
      id?: string;
      sku: { sku_code: string; name: string } | null;
    } | null;
  }>;
};

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

export type OpenCspoRow = {
  id: string;
  cspo_number: string;
  vessel: { name: string };
};

export type ReturnsSession = {
  inventory: OnboardSkuInventoryRow[];
  manifest: ReturnManifestRow | null;
  pending_transfers: PendingTransferRow[];
  open_cspos: OpenCspoRow[];
};

export async function fetchReturnsSession(cspoId: string): Promise<ReturnsSession> {
  const { data, error } = await supabase().rpc("get_returns_session", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;

  type RpcPayload = {
    inventory: OnboardSkuInventoryRow[];
    manifest: ReturnManifestRow | null;
    pending_transfers: PendingTransferRow[];
    open_cspos: OpenCspoRow[];
  };

  const payload = data as RpcPayload;
  return {
    inventory: payload.inventory ?? [],
    manifest: payload.manifest ?? null,
    pending_transfers: payload.pending_transfers ?? [],
    open_cspos: payload.open_cspos ?? [],
  };
}

export function useReturnsSession(cspoId: string, enabled = true) {
  return useQuery({
    queryKey: ["returns-session", cspoId],
    enabled: enabled && !!cspoId,
    queryFn: () => fetchReturnsSession(cspoId),
  });
}

export function useOnboardSkuInventory(cspoId: string, enabled = true) {
  return useQuery({
    queryKey: ["onboard-sku-inventory", cspoId],
    enabled: enabled && !!cspoId,
    queryFn: async () => {
      const { data, error } = await supabase().rpc("onboard_sku_inventory", {
        p_cspo_id: cspoId,
      });
      if (error) throw error;
      return (data ?? []) as OnboardSkuInventoryRow[];
    },
  });
}

export function useUsageLogs(cspoId: string) {
  return useQuery({
    queryKey: ["usage-logs", cspoId],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("usage_logs")
        .select(`
          id, action_type, logged_at, notes, location_on_vessel, qty,
          material_instance:material_instances(
            sku:skus(sku_code, name)
          )
        `)
        .eq("cspo_id", cspoId)
        .order("logged_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLogUsage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      instanceId,
      cspoId,
      actionType,
      notes,
      location,
    }: {
      instanceId: string;
      cspoId: string;
      actionType: "consumed" | "installed" | "damaged";
      notes?: string;
      location?: string;
    }) => {
      const { data, error } = await supabase().rpc("log_material_usage", {
        p_instance_id: instanceId,
        p_action_type: actionType,
        p_notes: notes ?? null,
        p_location: location ?? null,
      });
      if (error) throw error;
      return {
        cspoId,
        actionType,
        notes,
        location,
        result: data as {
          sku_id?: string;
          sku_code?: string;
          sku_name?: string;
          remaining_on_vessel?: number;
          ledger_entries?: LedgerAmountRow[];
        },
      };
    },
    onSuccess: ({ cspoId, actionType, notes, location, result }, _vars) => {
      if (result.sku_id) {
        patchOnboardSkuAfterUsage(
          qc,
          cspoId,
          result.sku_id,
          Number(result.remaining_on_vessel ?? 0),
        );
      }
      patchCspoWorkflowSummaryFromInventory(qc, cspoId);

      if (result.sku_code && result.sku_name) {
        patchUsageLogsAfterSkuLog(qc, cspoId, {
          skuCode: result.sku_code,
          skuName: result.sku_name,
          actionType,
          qty: 1,
          notes,
          location,
        });
        patchFinancialAfterUsageLog(qc, cspoId, {
          actionType,
          qty: 1,
          skuCode: result.sku_code,
          skuName: result.sku_name,
          notes,
          location,
          ledgerEntries: result.ledger_entries,
        });
        patchAboardBlockerSideEffects(qc, cspoId, -1, [{
          sku_code: result.sku_code,
          name: result.sku_name,
          qty: -1,
        }]);
      } else {
        patchFinancialItemsFromInventory(qc, cspoId);
        patchAboardBlockerSideEffects(qc, cspoId, -1);
      }
    },
  });
}

export function useLogSkuUsage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      cspoId: string;
      skuId: string;
      actionType: "consumed" | "installed" | "damaged";
      qty?: number;
      notes?: string;
      location?: string;
    }) => {
      if (!navigator.onLine) {
        const optimisticLogId = `optimistic-${crypto.randomUUID()}`;
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "log-sku-usage",
          payload: vars,
          createdAt: Date.now(),
          optimisticLogId,
        });
        return buildOfflineLogSkuUsageResult(qc, vars, optimisticLogId);
      }
      return executeLogSkuUsageRpc(vars);
    },
    onSuccess: (data, vars) => {
      applyLogSkuUsageSuccess(qc, vars, data.result, data.optimisticLogId);
    },
  });
}

export function useOpenCspos() {
  return useQuery({
    queryKey: ["open-cspos-select"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("cruise_ship_pos")
        .select("id, cspo_number, vessel:vessels(name)")
        .not("status", "in", "(closed,cancelled,draft)")
        .order("cspo_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePendingTransfers(cspoId?: string) {
  return useQuery({
    queryKey: ["pending-transfers", cspoId ?? "all"],
    queryFn: async () => {
      let q = supabase()
        .from("transfer_events")
        .select(`
          id, transferred_value, currency, initiated_at, notes, to_cspo_id,
          from_cspo:cruise_ship_pos!from_cspo_id(cspo_number),
          to_cspo:cruise_ship_pos!to_cspo_id(cspo_number),
          material_instance:material_instances(
            sku:skus(sku_code, name)
          )
        `)
        .is("acknowledged_at", null)
        .order("initiated_at", { ascending: false });

      if (cspoId) q = q.eq("to_cspo_id", cspoId);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Transfers initiated from this CSPO awaiting acknowledgement on the receiver. */
export function outboundPendingTransfersQueryKey(cspoId: string) {
  return ["pending-transfers", "outbound", cspoId] as const;
}

export async function fetchOutboundPendingTransfers(cspoId: string) {
  const { data, error } = await supabase()
    .from("transfer_events")
    .select(`
      id, to_cspo_id, transferred_value, currency, initiated_at, notes,
      to_cspo:cruise_ship_pos!to_cspo_id(cspo_number),
      material_instance:material_instances(
        sku:skus(sku_code, name)
      )
    `)
    .eq("from_cspo_id", cspoId)
    .is("acknowledged_at", null)
    .order("initiated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export function useOutboundPendingTransfers(cspoId: string, enabled = true) {
  return useQuery({
    queryKey: outboundPendingTransfersQueryKey(cspoId),
    enabled: enabled && !!cspoId,
    queryFn: () => fetchOutboundPendingTransfers(cspoId),
  });
}

export function useInitiateTransfer() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      instanceId,
      toCspoId,
      fromCspoId,
      notes,
    }: {
      instanceId: string;
      toCspoId: string;
      fromCspoId: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase().rpc("initiate_transfer", {
        p_instance_id: instanceId,
        p_to_cspo_id: toCspoId,
        p_notes: notes ?? null,
      });
      if (error) throw error;
      const result = data as {
        event_id?: string;
        transferred_value?: number;
        currency?: string;
        sku_id?: string;
        sku_code?: string;
        sku_name?: string;
        remaining_on_vessel?: number;
        ledger_entries?: LedgerAmountRow[];
      };
      return {
        eventId: result.event_id ?? (data as string),
        fromCspoId,
        toCspoId,
        instanceId,
        notes,
        transferredValue: Number(result.transferred_value ?? 0),
        currency: result.currency ?? "USD",
        skuId: result.sku_id,
        skuCode: result.sku_code,
        skuName: result.sku_name,
        remainingOnVessel: result.remaining_on_vessel,
        ledgerEntries: result.ledger_entries,
      };
    },
    onSuccess: ({
      eventId,
      fromCspoId,
      toCspoId,
      instanceId,
      notes,
      transferredValue,
      currency,
      skuId,
      skuCode,
      skuName,
      remainingOnVessel,
      ledgerEntries,
    }) => {
      const session = qc.getQueryData<ReturnsSession>(["returns-session", fromCspoId]);
      const instance = session?.manifest?.items?.find(
        (item) => item.material_instance?.id === instanceId,
      )?.material_instance;
      const sku = instance?.sku;
      const resolvedSkuCode = skuCode ?? sku?.sku_code;
      const resolvedSkuName = skuName ?? sku?.name;
      const inventory =
        qc.getQueryData<OnboardSkuInventoryRow[]>(["onboard-sku-inventory", fromCspoId]) ??
        qc.getQueryData<UsageLogSession>(["usage-log-session", fromCspoId])?.inventory ??
        session?.inventory;
      const sourceSkuId =
        skuId ?? inventory?.find((row) => row.sku_code === resolvedSkuCode)?.sku_id;
      const sourceRemaining =
        remainingOnVessel ??
        (sourceSkuId
          ? Math.max(
              0,
              (inventory?.find((row) => row.sku_id === sourceSkuId)?.aboard ?? 1) - 1,
            )
          : undefined);

      if (sourceSkuId && sourceRemaining !== undefined) {
        patchOnboardSkuAfterUsage(qc, fromCspoId, sourceSkuId, sourceRemaining);
        patchCspoWorkflowSummaryFromInventory(qc, fromCspoId);
      }

      const fromNumber =
        qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, fromCspoId])
          ?.cspo.cspo_number ?? fromCspoId.slice(0, 8);
      const toNumber =
        qc.getQueryData<CspoDetailSession>([CSPO_DETAIL_SESSION_QUERY_KEY, toCspoId])
          ?.cspo.cspo_number ?? toCspoId.slice(0, 8);

      if (resolvedSkuCode && resolvedSkuName) {
        patchFinancialAfterLedgerEntries(qc, fromCspoId, ledgerEntries ?? [{
          entry_type: "transferred_out",
          amount: -transferredValue,
        }], {
          skuCode: resolvedSkuCode,
          skuName: resolvedSkuName,
          notes: notes ?? "Transfer initiated",
        });
      } else {
        patchFinancialItemsFromInventory(qc, fromCspoId);
      }

      if (resolvedSkuCode && resolvedSkuName) {
        patchAboardBlockerSideEffects(qc, fromCspoId, -1, [{
          sku_code: resolvedSkuCode,
          name: resolvedSkuName,
          qty: -1,
        }]);
      } else {
        patchAboardBlockerSideEffects(qc, fromCspoId, -1);
      }

      patchOnboardHubPendingTransferDelta(qc, toCspoId, 1);
      patchReportsOverviewDelta(qc, "transferCount", 1);

      if (resolvedSkuCode && resolvedSkuName) {
        const auditRow = {
          transfer_id: eventId,
          initiated_at: new Date().toISOString(),
          sku_code: resolvedSkuCode,
          sku_name: resolvedSkuName,
          from_cspo: fromNumber,
          to_cspo: toNumber,
          transferred_value: transferredValue,
          currency,
          acknowledged_at: null,
        };
        patchTransferAuditPrepend(qc, [auditRow]);
        patchPendingTransfersPrepend(qc, toCspoId, fromCspoId, [{
          id: eventId,
          transferred_value: transferredValue,
          currency,
          initiated_at: auditRow.initiated_at,
          notes: notes ?? null,
          to_cspo_id: toCspoId,
          from_cspo: { cspo_number: fromNumber },
          to_cspo: { cspo_number: toNumber },
          material_instance: { sku: { sku_code: resolvedSkuCode, name: resolvedSkuName } },
        }]);
      }
    },
  });
}

export function useAcknowledgeTransfer() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (transferId: string) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "acknowledge-transfer",
          payload: { transferId },
          createdAt: Date.now(),
        });
        return buildOfflineAcknowledgeTransferResult(qc, transferId);
      }
      return executeAcknowledgeTransferRpc(transferId);
    },
    onSuccess: (data) => {
      applyAcknowledgeTransferSuccess(qc, data);
    },
  });
}

export function useReturnManifest(cspoId: string) {
  return useQuery({
    queryKey: ["return-manifest", cspoId],
    queryFn: async () => {
      const { data: manifest, error } = await supabase()
        .from("return_manifests")
        .select(`
          id, status, freight_company, created_at,
          items:return_manifest_items(
            id, condition,
            material_instance:material_instances(
              id, sku:skus(sku_code, name)
            )
          )
        `)
        .eq("cspo_id", cspoId)
        .eq("status", "draft")
        .maybeSingle();

      if (error) throw error;
      return manifest;
    },
  });
}

export function useCreateReturnManifest() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (cspoId: string) => {
      if (!navigator.onLine) {
        const optimisticManifestId = createOfflineManifestId();
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "create-return-manifest",
          payload: { cspoId },
          optimisticManifestId,
          createdAt: Date.now(),
        });
        return buildOfflineCreateReturnManifestResult(cspoId, optimisticManifestId);
      }

      const manifestId = await executeCreateReturnManifestRpc(cspoId);
      return { manifestId, cspoId };
    },
    onSuccess: ({ manifestId, cspoId }) => {
      applyCreateReturnManifestSuccess(qc, cspoId, manifestId);
    },
  });
}

export function useAddReturnItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      manifestId,
      instanceId,
      cspoId,
      condition = "good",
    }: {
      manifestId: string;
      instanceId: string;
      cspoId: string;
      condition?: "good" | "damaged" | "needs_inspection";
    }) => {
      const { data, error } = await supabase().rpc("add_return_manifest_item", {
        p_manifest_id: manifestId,
        p_instance_id: instanceId,
        p_condition: condition,
      });
      if (error) throw error;
      return {
        manifestId,
        cspoId,
        condition,
        result: (data ?? {}) as {
          instance_id?: string;
          sku_id?: string;
          sku_code?: string;
          sku_name?: string;
          on_manifest?: number;
        },
      };
    },
    onSuccess: ({ manifestId, cspoId, condition, result }, vars) => {
      const inventory =
        qc.getQueryData<OnboardSkuInventoryRow[]>(["onboard-sku-inventory", cspoId]) ??
        qc.getQueryData<ReturnsSession>(["returns-session", cspoId])?.inventory;

      const skuId = result.sku_id;
      const skuCode = result.sku_code;
      const skuName = result.sku_name;

      if (!skuId || !skuCode || !skuName) return;

      const priorOnManifest =
        inventory?.find((row) => row.sku_id === skuId)?.on_manifest ?? 0;

      patchReturnManifestAfterAddInstance(qc, cspoId, manifestId, {
        instanceId: result.instance_id ?? vars.instanceId,
        skuCode,
        skuName,
        condition,
      });
      patchOnboardSkuAfterReturnAdd(
        qc,
        cspoId,
        skuId,
        Number(result.on_manifest ?? priorOnManifest + 1),
      );
    },
  });
}

export function useAddReturnSkuQty() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      manifestId: string;
      cspoId: string;
      skuId: string;
      qty?: number;
      condition?: "good" | "damaged" | "needs_inspection";
    }) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "add-return-sku-qty",
          payload: vars,
          createdAt: Date.now(),
        });
        return buildOfflineAddReturnSkuQtyResult(qc, vars);
      }
      return executeAddReturnSkuQtyRpc(vars);
    },
    onSuccess: (data, vars) => {
      applyAddReturnSkuQtySuccess(qc, vars, data.result);
    },
  });
}

export function useInitiateTransferSkuQty() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      cspoId: string;
      skuId: string;
      toCspoId: string;
      qty?: number;
      notes?: string;
    }) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "initiate-transfer-sku-qty",
          payload: vars,
          createdAt: Date.now(),
        });
        return buildOfflineInitiateTransferSkuQtyResult(qc, vars);
      }
      return executeInitiateTransferSkuQtyRpc(vars);
    },
    onSuccess: (data) => {
      applyInitiateTransferSkuQtySuccess(qc, data);
    },
  });
}

export function useSealReturnManifest() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      manifestId: string;
      cspoId: string;
      freight?: string;
    }) => {
      if (!navigator.onLine) {
        const manifest =
          qc.getQueryData<ReturnsSession>(["returns-session", vars.cspoId])?.manifest ??
          qc.getQueryData<ReturnManifestRow | null>(["return-manifest", vars.cspoId]);

        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "seal-return-manifest",
          payload: vars,
          manifestItemsSnapshot: manifest?.items.map((item) => ({ ...item })),
          restockManifestId: vars.manifestId,
          createdAt: Date.now(),
        });
        return buildOfflineSealReturnManifestResult(vars);
      }

      return executeSealReturnManifestRpc(vars);
    },
    onSuccess: (data) => {
      const manifestItems =
        data.queued
          ? (
              qc.getQueryData<ReturnsSession>(["returns-session", data.cspoId])?.manifest ??
              qc.getQueryData<ReturnManifestRow | null>(["return-manifest", data.cspoId])
            )?.items
          : undefined;

      applySealReturnManifestSuccess(
        qc,
        data,
        manifestItems?.length ? manifestItems : undefined,
      );
    },
  });
}
