import type { QueryClient } from "@tanstack/react-query";
import type { ReturnRestockJob } from "@/hooks/useClosure";
import type { ReturnManifestRow } from "@/hooks/useOnboard";
import {
  patchWarehouseHubAfterRestockComplete,
  patchWarehouseHubAfterRestockManifestSealed,
  patchWarehouseHubAfterRestockReceive,
} from "@/lib/warehouseHubCache";
import { CSPO_DETAIL_SESSION_QUERY_KEY, type CspoDetailSession } from "@/hooks/useCspos";
import { CSPO_LIST_QUERY_KEY } from "@/lib/cspoListCache";

export function patchReturnRestockAfterReceive(
  qc: QueryClient,
  manifestId: string,
  skuId: string,
  result: { received: number; pending: number },
) {
  if (result.received <= 0) return;

  qc.setQueryData<ReturnRestockJob[]>(["return-receipt-jobs"], (old) => {
    if (!old) return old;
    return old.map((manifest) => {
      if (manifest.manifest_id !== manifestId) return manifest;
      const skus = manifest.skus.map((sku) => {
        if (sku.sku_id !== skuId) return sku;
        return {
          ...sku,
          pending: result.pending,
          received: sku.received + result.received,
        };
      });
      return {
        ...manifest,
        skus,
        pending_units: Math.max(0, manifest.pending_units - result.received),
        received_units: manifest.received_units + result.received,
      };
    });
  });

  patchWarehouseHubAfterRestockReceive(qc, result.received);
}

export function patchReturnRestockSetSkuProgress(
  qc: QueryClient,
  manifestId: string,
  skuId: string,
  progress: { received: number; pending: number },
) {
  qc.setQueryData<ReturnRestockJob[]>(["return-receipt-jobs"], (old) => {
    if (!old) return old;
    return old.map((manifest) => {
      if (manifest.manifest_id !== manifestId) return manifest;
      const skus = manifest.skus.map((sku) =>
        sku.sku_id === skuId
          ? { ...sku, received: progress.received, pending: progress.pending }
          : sku,
      );
      return {
        ...manifest,
        skus,
        pending_units: skus.reduce((sum, row) => sum + row.pending, 0),
        received_units: skus.reduce((sum, row) => sum + row.received, 0),
      };
    });
  });
}

export function patchReturnRestockRenameManifestId(
  qc: QueryClient,
  fromId: string,
  toId: string,
) {
  if (fromId === toId) return;

  qc.setQueryData<ReturnRestockJob[]>(["return-receipt-jobs"], (old) => {
    if (!old) return old;
    const hasTarget = old.some((row) => row.manifest_id === toId);
    return old.flatMap((row) => {
      if (row.manifest_id !== fromId) return [row];
      if (hasTarget) return [];
      return [{ ...row, manifest_id: toId }];
    });
  });
}

export function patchReturnRestockRemoveManifest(qc: QueryClient, manifestId: string) {
  const jobs = qc.getQueryData<ReturnRestockJob[]>(["return-receipt-jobs"]);
  const manifest = jobs?.find((m) => m.manifest_id === manifestId);
  const pendingUnits = manifest?.pending_units ?? 0;

  qc.setQueryData<ReturnRestockJob[]>(["return-receipt-jobs"], (old) => {
    if (!old) return old;
    return old.filter((m) => m.manifest_id !== manifestId);
  });

  patchWarehouseHubAfterRestockComplete(qc, pendingUnits);
}

export function patchReturnRestockPrependAfterSeal(
  qc: QueryClient,
  opts: {
    manifestId: string;
    cspoId: string;
    freight?: string | null;
    items: ReturnManifestRow["items"];
  },
) {
  if (opts.items.length === 0) return;

  const detail = qc.getQueryData<CspoDetailSession>([
    CSPO_DETAIL_SESSION_QUERY_KEY,
    opts.cspoId,
  ]);
  const listRow = qc
    .getQueryData<Array<{ id: string; cspo_number: string; vessel: { name: string } | null }>>(
      CSPO_LIST_QUERY_KEY,
    )
    ?.find((row) => row.id === opts.cspoId);

  const skuMap = new Map<
    string,
    { sku_id: string; sku_code: string; name: string; pending: number; received: number }
  >();

  for (const item of opts.items) {
    const sku = item.material_instance?.sku;
    if (!sku) continue;
    const key = sku.sku_code;
    const prev = skuMap.get(key);
    skuMap.set(key, {
      sku_id: prev?.sku_id ?? key,
      sku_code: sku.sku_code,
      name: sku.name,
      pending: (prev?.pending ?? 0) + 1,
      received: prev?.received ?? 0,
    });
  }

  const skus = [...skuMap.values()];
  const totalUnits = opts.items.length;

  const job: ReturnRestockJob = {
    manifest_id: opts.manifestId,
    status: "ready",
    freight_company: opts.freight ?? null,
    created_at: new Date().toISOString(),
    cspo_id: opts.cspoId,
    cspo_number: detail?.cspo.cspo_number ?? listRow?.cspo_number ?? opts.cspoId.slice(0, 8),
    vessel_name:
      detail?.cspo.vessel?.name ?? listRow?.vessel?.name ?? "Vessel",
    total_units: totalUnits,
    pending_units: totalUnits,
    received_units: 0,
    skus,
  };

  qc.setQueryData<ReturnRestockJob[]>(["return-receipt-jobs"], (old) => {
    if (!old) return old;
    if (old.some((row) => row.manifest_id === opts.manifestId)) return old;
    return [job, ...old];
  });

  patchWarehouseHubAfterRestockManifestSealed(qc, totalUnits);
}
