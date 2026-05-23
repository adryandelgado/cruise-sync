import type { QueryClient } from "@tanstack/react-query";
import type { SalesQuoteRow } from "@/lib/salesQuoteListFilters";

export const SALES_QUOTES_QUERY_KEY = ["sales-quotes"] as const;

export function patchSalesQuotesPrepend(qc: QueryClient, row: SalesQuoteRow) {
  qc.setQueryData<SalesQuoteRow[]>(SALES_QUOTES_QUERY_KEY, (old) => {
    if (!old) return old;
    if (old.some((existing) => existing.id === row.id)) return old;
    return [row, ...old];
  });
}

export function patchSalesQuoteStatus(
  qc: QueryClient,
  quoteId: string,
  status: string,
) {
  qc.setQueryData<SalesQuoteRow[]>(SALES_QUOTES_QUERY_KEY, (old) => {
    if (!old) return old;
    return old.map((row) => (row.id === quoteId ? { ...row, status } : row));
  });

  qc.setQueryData<SalesQuoteDetailCache>(
    ["sales-quotes", quoteId],
    (old) => {
      if (!old?.quote) return old;
      return { ...old, quote: { ...old.quote, status } };
    },
  );
}

export type SalesQuoteDetailCache = {
  quote: Record<string, unknown>;
  lines: unknown[];
};

export function patchSalesQuoteDetailSeed(
  qc: QueryClient,
  quoteId: string,
  detail: SalesQuoteDetailCache,
) {
  qc.setQueryData(["sales-quotes", quoteId], detail);
}
