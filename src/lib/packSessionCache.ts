import type { QueryClient } from "@tanstack/react-query";
import type { PackSession } from "@/hooks/usePackJobs";

export type PackItemPatch = {
  cspoId: string;
  listItemId: string;
  packageId: string;
  packedDelta: number;
  skuId: string | null;
};

export function patchPackSessionAfterPack(qc: QueryClient, patch: PackItemPatch) {
  if (patch.packedDelta <= 0) return;

  qc.setQueryData<PackSession>(["pack-session", patch.cspoId], (old) => {
    if (!old) return old;

    const items = old.list.items.map((item) => {
      if (item.id !== patch.listItemId) return item;
      const requested_qty = Number(item.requested_qty);
      const packed_qty = Number(item.packed_qty) + patch.packedDelta;
      return {
        ...item,
        packed_qty,
        status: packed_qty >= requested_qty ? "complete" : item.status,
      };
    });

    const packages = old.packages.map((pkg) => {
      if (pkg.id !== patch.packageId) return pkg;
      const prev = pkg.contents.reduce((s, c) => s + Number(c.qty), 0);
      return { ...pkg, contents: [{ qty: prev + patch.packedDelta }] };
    });

    const stockBySku = { ...old.stockBySku };
    if (patch.skuId) {
      stockBySku[patch.skuId] = Math.max(0, (stockBySku[patch.skuId] ?? 0) - patch.packedDelta);
    }

    const listStatus =
      old.list.status === "submitted" ? "in_packing" : old.list.status;

    return {
      ...old,
      list: { ...old.list, status: listStatus, items },
      packages,
      stockBySku,
    };
  });
}

export function patchPackSessionAddPackage(
  qc: QueryClient,
  cspoId: string,
  pkg: { id: string; package_type: string; package_number: number },
) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      packages: [
        ...old.packages,
        {
          id: pkg.id,
          package_type: pkg.package_type,
          package_number: pkg.package_number,
          status: "open",
          length: null,
          width: null,
          height: null,
          weight: null,
          contents: [],
        },
      ],
    };
  });
}

export function patchPackSessionReplacePackageId(
  qc: QueryClient,
  cspoId: string,
  fromId: string,
  to: { id: string; package_type: string; package_number: number },
) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      packages: old.packages.map((pkg) =>
        pkg.id === fromId
          ? {
              ...pkg,
              id: to.id,
              package_type: to.package_type,
              package_number: to.package_number,
            }
          : pkg,
      ),
    };
  });
}

export function patchPackSessionPackageSpecs(
  qc: QueryClient,
  cspoId: string,
  packageId: string,
  specs: {
    length?: number;
    width?: number;
    height?: number;
    weight?: number;
  },
) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      packages: old.packages.map((pkg) =>
        pkg.id === packageId
          ? {
              ...pkg,
              length: specs.length ?? pkg.length,
              width: specs.width ?? pkg.width,
              height: specs.height ?? pkg.height,
              weight: specs.weight ?? pkg.weight,
            }
          : pkg,
      ),
    };
  });
}

export function patchPackSessionAfterComplete(qc: QueryClient, cspoId: string) {
  qc.setQueryData<PackSession>(["pack-session", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      cspo: { ...old.cspo, status: "in_transit" },
      list: { ...old.list, status: "complete" },
      packages: old.packages.map((pkg) =>
        pkg.status === "open" || pkg.status === "sealed"
          ? { ...pkg, status: "in_transit" }
          : pkg,
      ),
    };
  });
}
