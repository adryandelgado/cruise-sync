import type { QueryClient } from "@tanstack/react-query";
import type { PackSession } from "@/hooks/usePackJobs";
import { patchCspoDetailAfterPackingComplete } from "@/lib/cspoDetailCache";
import { patchDashboardAfterPackingComplete } from "@/lib/dashboardStatsCache";
import {
  patchPackSessionAfterComplete,
  patchPackSessionAfterPack,
  patchPackSessionAddPackage,
  patchPackSessionReplacePackageId,
  type PackItemPatch,
} from "@/lib/packSessionCache";
import { patchPackingDocsAfterComplete, patchPackingDocsAfterSignPod } from "@/lib/packingDocsCache";
import { patchWarehouseHubFromPackList, patchWarehouseHubRemovePackJob } from "@/lib/warehouseHubCache";
import { supabase } from "@/lib/supabase";

export type PackItemVars = {
  listItemId: string;
  packageId: string;
  cspoId: string;
  isCustom: boolean;
  qty?: number;
};

export type PackItemMutationResult = PackItemPatch & {
  queued?: boolean;
};

export type SignPodVars = {
  podId: string;
  cspoId: string;
  freightCompany: string;
  driverName: string;
};

export type SignPodMutationResult = {
  cspoId: string;
  podId: string;
  freightCompany: string;
  driverName: string;
  signedAt: string;
  queued?: boolean;
};

export type CompletePackingVars = {
  cspoId: string;
};

export type CompletePackingMutationResult = {
  cspoId: string;
  invoice_id: string;
  invoice_number: string;
  total_value: number;
  queued?: boolean;
};

export type CreatePackageVars = {
  cspoId: string;
  packageType: string;
  orgId: string;
};

export type CreatePackageMutationResult = {
  id: string;
  package_type: string;
  package_number: number;
  cspoId: string;
  queued?: boolean;
};

function packSession(qc: QueryClient, cspoId: string) {
  return qc.getQueryData<PackSession>(["pack-session", cspoId]);
}

function assertCanCompletePacking(qc: QueryClient, cspoId: string) {
  const session = packSession(qc, cspoId);
  if (!session) throw new Error("Pack session not loaded");

  if (
    session.list.items.some(
      (item) => Number(item.packed_qty) < Number(item.requested_qty),
    )
  ) {
    throw new Error("Not all items are fully packed");
  }

  if (!session.packages.some((pkg) => pkg.status === "open")) {
    throw new Error("Create at least one open package with items before completing");
  }
}

function packListItem(
  qc: QueryClient,
  cspoId: string,
  listItemId: string,
): PackSession["list"]["items"][number] | undefined {
  return packSession(qc, cspoId)?.list.items.find((item) => item.id === listItemId);
}

function computeOfflinePackedDelta(qc: QueryClient, vars: PackItemVars): number {
  const item = packListItem(qc, vars.cspoId, vars.listItemId);
  const requestedQty = vars.qty ?? 1;
  if (!item) return requestedQty;

  const remaining = Math.max(0, Number(item.requested_qty) - Number(item.packed_qty));
  if (vars.isCustom) {
    return Math.min(requestedQty, remaining);
  }

  const stock = item.sku_id
    ? (qc.getQueryData<PackSession>(["pack-session", vars.cspoId])?.stockBySku[item.sku_id] ?? 0)
    : 0;

  if (stock <= 0) {
    throw new Error("No in-stock instances available for this SKU");
  }

  return Math.min(requestedQty, remaining, stock);
}

export async function executePackItemRpc(vars: PackItemVars): Promise<PackItemMutationResult> {
  const qty = vars.qty ?? 1;

  if (vars.isCustom) {
    const { error } = await supabase().rpc("pack_custom_list_item", {
      p_list_item_id: vars.listItemId,
      p_package_id: vars.packageId,
      p_qty: qty,
    });
    if (error) throw error;
    return {
      cspoId: vars.cspoId,
      listItemId: vars.listItemId,
      packageId: vars.packageId,
      packedDelta: qty,
      skuId: null,
    };
  }

  if (qty > 1) {
    const { data, error } = await supabase().rpc("pack_list_item_qty", {
      p_list_item_id: vars.listItemId,
      p_package_id: vars.packageId,
      p_qty: qty,
    });
    if (error) throw error;
    const result = data as { packed: number; remaining: number };
    if (result.packed === 0) {
      throw new Error("No in-stock instances available for this SKU");
    }
    return {
      cspoId: vars.cspoId,
      listItemId: vars.listItemId,
      packageId: vars.packageId,
      packedDelta: result.packed,
      skuId: null,
    };
  }

  const { error } = await supabase().rpc("pack_list_item_unit", {
    p_list_item_id: vars.listItemId,
    p_package_id: vars.packageId,
  });
  if (error) throw error;

  return {
    cspoId: vars.cspoId,
    listItemId: vars.listItemId,
    packageId: vars.packageId,
    packedDelta: 1,
    skuId: null,
  };
}

export function applyPackItemSuccess(qc: QueryClient, patch: PackItemMutationResult, skuId: string | null) {
  patchPackSessionAfterPack(qc, { ...patch, skuId });
  const nextSession = qc.getQueryData<PackSession>(["pack-session", patch.cspoId]);
  if (nextSession) {
    patchWarehouseHubFromPackList(qc, patch.cspoId, nextSession.list);
  }
}

export function buildOfflinePackItemResult(
  qc: QueryClient,
  vars: PackItemVars,
): PackItemMutationResult {
  const packedDelta = computeOfflinePackedDelta(qc, vars);
  if (packedDelta <= 0) {
    throw new Error("No in-stock instances available for this SKU");
  }

  const item = packListItem(qc, vars.cspoId, vars.listItemId);

  return {
    cspoId: vars.cspoId,
    listItemId: vars.listItemId,
    packageId: vars.packageId,
    packedDelta,
    skuId: item?.sku_id ?? null,
    queued: true,
  };
}

export function reconcilePackItemReplay(
  qc: QueryClient,
  vars: PackItemVars,
  result: PackItemMutationResult,
) {
  const item = packListItem(qc, vars.cspoId, vars.listItemId);
  const skuId = item?.sku_id ?? result.skuId;
  const optimisticQty = vars.qty ?? 1;

  if (result.packedDelta !== optimisticQty) {
    patchPackSessionAfterPack(qc, {
      ...result,
      packedDelta: -optimisticQty,
      skuId,
    });
    applyPackItemSuccess(qc, result, skuId);
  }
}

export async function executeSignPodRpc(vars: SignPodVars): Promise<SignPodMutationResult> {
  const signedAt = new Date().toISOString();
  const { error } = await supabase()
    .from("pods")
    .update({
      freight_company: vars.freightCompany,
      driver_name: vars.driverName,
      signed_at: signedAt,
    })
    .eq("id", vars.podId);
  if (error) throw error;

  return {
    cspoId: vars.cspoId,
    podId: vars.podId,
    freightCompany: vars.freightCompany,
    driverName: vars.driverName,
    signedAt,
  };
}

export function applySignPodSuccess(
  qc: QueryClient,
  { cspoId, podId, freightCompany, driverName, signedAt }: SignPodMutationResult,
) {
  patchPackingDocsAfterSignPod(qc, cspoId, podId, {
    freightCompany,
    driverName,
    signedAt,
  });
}

export function buildOfflineSignPodResult(vars: SignPodVars): SignPodMutationResult {
  return {
    cspoId: vars.cspoId,
    podId: vars.podId,
    freightCompany: vars.freightCompany,
    driverName: vars.driverName,
    signedAt: new Date().toISOString(),
    queued: true,
  };
}

export function reconcileSignPodReplay(qc: QueryClient, result: SignPodMutationResult) {
  applySignPodSuccess(qc, result);
}

export async function executeCompletePackingRpc(
  cspoId: string,
): Promise<CompletePackingMutationResult> {
  const { data, error } = await supabase().rpc("complete_packing", {
    p_cspo_id: cspoId,
  });
  if (error) throw error;

  const result = data as {
    invoice_id: string;
    invoice_number: string;
    total_value: number;
  };

  return {
    cspoId,
    invoice_id: result.invoice_id,
    invoice_number: result.invoice_number,
    total_value: Number(result.total_value),
  };
}

export function applyCompletePackingSuccess(
  qc: QueryClient,
  result: CompletePackingMutationResult,
) {
  patchCspoDetailAfterPackingComplete(qc, result.cspoId);
  patchDashboardAfterPackingComplete(qc);
  patchWarehouseHubRemovePackJob(qc, result.cspoId);
  patchPackSessionAfterComplete(qc, result.cspoId);
  patchPackingDocsAfterComplete(qc, result.cspoId, {
    invoiceId: result.invoice_id,
    invoiceNumber: result.invoice_number,
    totalValue: result.total_value,
  });
}

export function buildOfflineCompletePackingResult(
  qc: QueryClient,
  cspoId: string,
): CompletePackingMutationResult {
  assertCanCompletePacking(qc, cspoId);
  const session = packSession(qc, cspoId);

  return {
    cspoId,
    invoice_id: `offline-invoice-${cspoId}`,
    invoice_number: `COI-${session?.cspo.cspo_number ?? cspoId.slice(0, 8)}`,
    total_value: 0,
    queued: true,
  };
}

export function reconcileCompletePackingReplay(
  qc: QueryClient,
  result: CompletePackingMutationResult,
) {
  const session = packSession(qc, result.cspoId);
  const alreadyComplete =
    session?.cspo.status === "in_transit" || session?.cspo.status === "on_vessel";

  if (alreadyComplete) {
    patchPackingDocsAfterComplete(qc, result.cspoId, {
      invoiceId: result.invoice_id,
      invoiceNumber: result.invoice_number,
      totalValue: result.total_value,
    });
    return;
  }

  applyCompletePackingSuccess(qc, result);
}

function nextPackageNumber(qc: QueryClient, cspoId: string): number {
  const packages = packSession(qc, cspoId)?.packages ?? [];
  const maxNum = packages.reduce(
    (max, pkg) => Math.max(max, Number(pkg.package_number)),
    0,
  );
  return maxNum + 1;
}

export async function executeCreatePackageRpc(
  vars: CreatePackageVars,
): Promise<CreatePackageMutationResult> {
  const { data: existing } = await supabase()
    .from("packages")
    .select("package_number")
    .eq("cspo_id", vars.cspoId)
    .order("package_number", { ascending: false })
    .limit(1);

  const nextNum = (existing?.[0]?.package_number ?? 0) + 1;

  const { data, error } = await supabase()
    .from("packages")
    .insert({
      org_id: vars.orgId,
      cspo_id: vars.cspoId,
      package_type: vars.packageType,
      package_number: nextNum,
    })
    .select("id, package_number, package_type")
    .single();

  if (error) throw error;

  return {
    id: data.id,
    package_type: data.package_type,
    package_number: data.package_number,
    cspoId: vars.cspoId,
  };
}

export function applyCreatePackageSuccess(
  qc: QueryClient,
  result: CreatePackageMutationResult,
) {
  patchPackSessionAddPackage(qc, result.cspoId, {
    id: result.id,
    package_type: result.package_type,
    package_number: result.package_number,
  });
}

export function buildOfflineCreatePackageResult(
  qc: QueryClient,
  vars: CreatePackageVars,
  optimisticPackageId: string,
): CreatePackageMutationResult {
  return {
    id: optimisticPackageId,
    package_type: vars.packageType,
    package_number: nextPackageNumber(qc, vars.cspoId),
    cspoId: vars.cspoId,
    queued: true,
  };
}

export function reconcileCreatePackageReplay(
  qc: QueryClient,
  vars: CreatePackageVars,
  optimisticPackageId: string,
  result: CreatePackageMutationResult,
  remapPackageIdInQueue: (fromId: string, toId: string) => void,
) {
  const session = packSession(qc, vars.cspoId);
  const hasOptimistic = session?.packages.some((pkg) => pkg.id === optimisticPackageId);

  if (!hasOptimistic) {
    applyCreatePackageSuccess(qc, result);
    return;
  }

  if (result.id !== optimisticPackageId) {
    patchPackSessionReplacePackageId(qc, vars.cspoId, optimisticPackageId, {
      id: result.id,
      package_type: result.package_type,
      package_number: result.package_number,
    });
    remapPackageIdInQueue(optimisticPackageId, result.id);
    return;
  }

  const optimisticPkg = session?.packages.find((pkg) => pkg.id === optimisticPackageId);
  if (optimisticPkg && result.package_number !== optimisticPkg.package_number) {
    patchPackSessionReplacePackageId(qc, vars.cspoId, optimisticPackageId, {
      id: result.id,
      package_type: result.package_type,
      package_number: result.package_number,
    });
  }
}
