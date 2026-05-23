import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { enqueueOfflineMutation } from "@/lib/offlineMutationQueue";
import { supabase } from "@/lib/supabase";
import { patchPackSessionPackageSpecs } from "@/lib/packSessionCache";
import {
  mapWarehouseHubFromRpc,
  WAREHOUSE_HUB_QUERY_KEY,
  type WarehouseHub,
  type WarehouseHubRpc,
} from "@/lib/warehouseHubCache";
import {
  applyCompletePackingSuccess,
  applyCreatePackageSuccess,
  applyPackItemSuccess,
  applySignPodSuccess,
  buildOfflineCompletePackingResult,
  buildOfflineCreatePackageResult,
  buildOfflinePackItemResult,
  buildOfflineSignPodResult,
  executeCompletePackingRpc,
  executeCreatePackageRpc,
  executePackItemRpc,
  executeSignPodRpc,
} from "@/lib/warehouseOfflineMutations";

export type PackJobRow = {
  cspo_id: string;
  cspo_number: string;
  status: string;
  attendance_type: string;
  planned_end: string | null;
  vessel: { id: string; name: string; fleet: { name: string } | null } | null;
  material_list: {
    id: string;
    status: string;
    item_count: number;
    packed_count: number;
    total_units: number;
    packed_units: number;
    remaining_units: number;
    is_fully_packed: boolean;
  } | null;
};

export async function fetchWarehouseHub(): Promise<WarehouseHub> {
  const { data, error } = await supabase().rpc("get_warehouse_hub");
  if (error) throw error;
  return mapWarehouseHubFromRpc(data as WarehouseHubRpc);
}

export function useWarehouseHub() {
  return useQuery({
    queryKey: WAREHOUSE_HUB_QUERY_KEY,
    queryFn: fetchWarehouseHub,
  });
}

export function usePackJobs() {
  const query = useWarehouseHub();
  return {
    ...query,
    data: query.data?.packJobs,
  };
}

/** Jobs that still need units packed onto pallets. */
export function useActivePackJobs() {
  const query = usePackJobs();
  return {
    ...query,
    data: query.data?.filter(
      (job) => job.material_list && job.material_list.remaining_units > 0,
    ),
  };
}

/** All units packed — waiting for seal, dimensions, and shipping docs. */
export function useReadyToFinishPackJobs() {
  const query = usePackJobs();
  return {
    ...query,
    data: query.data?.filter(
      (job) => job.material_list?.is_fully_packed,
    ),
  };
}

export type PackSession = {
  cspo: {
    id: string;
    cspo_number: string;
    status: string;
    attendance_type: string;
    vessel: { name: string; fleet: { name: string } | null } | null;
  };
  list: {
    id: string;
    status: string;
    items: Array<{
      id: string;
      sku_id: string | null;
      custom_description: string | null;
      requested_qty: number;
      packed_qty: number;
      status: string;
      procurement_request_id: string | null;
      procurement_request: {
        id: string;
        status: string;
        qty_needed: number;
        qty_received: number;
      } | null;
      sku: { sku_code: string; name: string; unit_of_measure: string } | null;
    }>;
  };
  packages: Array<{
    id: string;
    package_type: string;
    package_number: number;
    status: string;
    length: number | null;
    width: number | null;
    height: number | null;
    weight: number | null;
    contents: Array<{
      qty: number;
    }>;
  }>;
  stockBySku: Record<string, number>;
};

export async function fetchPackSession(cspoId: string): Promise<PackSession> {
  const { data, error } = await supabase().rpc("get_pack_session", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;

  type RpcPayload = {
    cspo: PackSession["cspo"];
    list: {
      id: string;
      status: string;
      items: Array<
        PackSession["list"]["items"][number] & { created_at?: string }
      >;
    };
    packages: PackSession["packages"];
    stock_by_sku: Record<string, number>;
  };

  const payload = data as RpcPayload;
  const items = (payload.list.items ?? []).map(
    ({ created_at: _ignored, ...rest }) => rest,
  );

  return {
    cspo: payload.cspo,
    list: {
      id: payload.list.id,
      status: payload.list.status,
      items,
    },
    packages: payload.packages ?? [],
    stockBySku: payload.stock_by_sku ?? {},
  };
}

export function usePackSession(cspoId: string) {
  return useQuery({
    queryKey: ["pack-session", cspoId],
    queryFn: () => fetchPackSession(cspoId),
  });
}

export function useCreatePackage() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      cspoId,
      packageType,
    }: {
      cspoId: string;
      packageType: string;
    }) => {
      if (!profile) throw new Error("Not authenticated");

      const vars = {
        cspoId,
        packageType,
        orgId: profile.org_id,
      };

      if (!navigator.onLine) {
        const optimisticPackageId = crypto.randomUUID();
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "create-package",
          payload: vars,
          optimisticPackageId,
          createdAt: Date.now(),
        });
        return buildOfflineCreatePackageResult(qc, vars, optimisticPackageId);
      }

      return executeCreatePackageRpc(vars);
    },
    onSuccess: (data) => {
      applyCreatePackageSuccess(qc, data);
    },
  });
}

export function usePackItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      listItemId: string;
      packageId: string;
      cspoId: string;
      isCustom: boolean;
      qty?: number;
    }) => {
      if (!navigator.onLine) {
        const offline = buildOfflinePackItemResult(qc, vars);
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "pack-list-item",
          payload: { ...vars, qty: offline.packedDelta },
          createdAt: Date.now(),
        });
        return offline;
      }
      return executePackItemRpc(vars);
    },
    onSuccess: (patch, vars) => {
      const session = qc.getQueryData<PackSession>(["pack-session", vars.cspoId]);
      const item = session?.list.items.find((i) => i.id === vars.listItemId);
      applyPackItemSuccess(qc, patch, item?.sku_id ?? patch.skuId);
    },
  });
}

export function useUpdatePackageSpecs() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      packageId,
      cspoId,
      length,
      width,
      height,
      weight,
    }: {
      packageId: string;
      cspoId: string;
      length?: number;
      width?: number;
      height?: number;
      weight?: number;
    }) => {
      const { error } = await supabase()
        .from("packages")
        .update({ length, width, height, weight })
        .eq("id", packageId);
      if (error) throw error;
      return { cspoId, packageId, length, width, height, weight };
    },
    onSuccess: ({ cspoId, packageId, length, width, height, weight }) => {
      patchPackSessionPackageSpecs(qc, cspoId, packageId, {
        length,
        width,
        height,
        weight,
      });
    },
  });
}

export function useCompletePacking() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (cspoId: string) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "complete-packing",
          payload: { cspoId },
          createdAt: Date.now(),
        });
        return buildOfflineCompletePackingResult(qc, cspoId);
      }
      return executeCompletePackingRpc(cspoId);
    },
    onSuccess: (data) => {
      applyCompletePackingSuccess(qc, data);
    },
  });
}

export async function fetchPackingDocs(cspoId: string) {
  const [cspoRes, packagesRes, invoiceRes, podRes] = await Promise.all([
    supabase()
      .from("cruise_ship_pos")
      .select(`
        id, cspo_number, currency, port_of_service, status,
        vessel:vessels(name, fleet:fleets(name))
      `)
      .eq("id", cspoId)
      .single(),
    supabase()
      .from("packages")
      .select(`
        id, package_type, package_number, length, width, height, weight,
        contents:package_contents(
          qty, description,
          material_instance:material_instances(
            sku:skus(sku_code, name, hts_code, default_cost)
          )
        )
      `)
      .eq("cspo_id", cspoId)
      .order("package_number"),
    supabase()
      .from("commercial_invoices")
      .select("id, invoice_number, total_value, currency, issued_at")
      .eq("cspo_id", cspoId)
      .maybeSingle(),
    supabase()
      .from("pods")
      .select("id, freight_company, driver_name, signed_at")
      .eq("cspo_id", cspoId)
      .maybeSingle(),
  ]);

  if (cspoRes.error) throw cspoRes.error;

  return {
    cspo: cspoRes.data,
    packages: packagesRes.data ?? [],
    invoice: invoiceRes.data,
    pod: podRes.data,
  };
}

export function usePackingDocs(cspoId: string) {
  return useQuery({
    queryKey: ["packing-docs", cspoId],
    queryFn: () => fetchPackingDocs(cspoId),
  });
}

export function useSignPod() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      podId: string;
      cspoId: string;
      freightCompany: string;
      driverName: string;
    }) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "sign-pod",
          payload: vars,
          createdAt: Date.now(),
        });
        return buildOfflineSignPodResult(vars);
      }
      return executeSignPodRpc(vars);
    },
    onSuccess: (data) => {
      applySignPodSuccess(qc, data);
    },
  });
}
