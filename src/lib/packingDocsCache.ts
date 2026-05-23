import type { QueryClient } from "@tanstack/react-query";
import type { PackSession } from "@/hooks/usePackJobs";

type PackingDocsCache = {
  cspo: unknown;
  packages: unknown[];
  invoice: unknown;
  pod: {
    id: string;
    freight_company: string | null;
    driver_name: string | null;
    signed_at: string | null;
  } | null;
};

export function patchPackingDocsAfterComplete(
  qc: QueryClient,
  cspoId: string,
  data: {
    invoiceId: string;
    invoiceNumber: string;
    totalValue: number;
    currency?: string;
  },
) {
  const session = qc.getQueryData<PackSession>(["pack-session", cspoId]);

  qc.setQueryData<PackingDocsCache>(["packing-docs", cspoId], (old) => {
    const cspoRaw = old?.cspo as Record<string, unknown> | undefined;
    const currency =
      data.currency ??
      (typeof cspoRaw?.currency === "string" ? cspoRaw.currency : "USD");

    return {
      cspo: {
        ...(cspoRaw ?? {}),
        id: cspoId,
        cspo_number: session?.cspo.cspo_number ?? cspoRaw?.cspo_number,
        status: "in_transit",
        currency,
        port_of_service: cspoRaw?.port_of_service ?? null,
        vessel: cspoRaw?.vessel ?? session?.cspo.vessel ?? null,
      },
      packages: old?.packages?.length ? old.packages : (session?.packages ?? []),
      invoice: {
        id: data.invoiceId,
        invoice_number: data.invoiceNumber,
        total_value: data.totalValue,
        currency,
        issued_at: new Date().toISOString(),
      },
      pod: old?.pod ?? {
        id: `offline-pod-${cspoId}`,
        freight_company: null,
        driver_name: null,
        signed_at: null,
      },
    };
  });
}

export function patchPackingDocsAfterSignPod(
  qc: QueryClient,
  cspoId: string,
  podId: string,
  data: {
    freightCompany: string;
    driverName: string;
    signedAt: string;
  },
) {
  qc.setQueryData<PackingDocsCache>(["packing-docs", cspoId], (old) => {
    if (!old) return old;
    return {
      ...old,
      pod: {
        id: podId,
        freight_company: data.freightCompany,
        driver_name: data.driverName,
        signed_at: data.signedAt,
      },
    };
  });
}
