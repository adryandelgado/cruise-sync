import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  patchPackSessionAfterProcurementCreate,
  type ProcurementRequestRow,
} from "@/lib/procurementSessionCache";
import {
  buildProcurementRequestRow,
  mapProcurementHubFromRpc,
  patchProcurementHubAfterCreate,
  PROCUREMENT_HUB_QUERY_KEY,
  type ProcurementHub,
  type ProcurementHubRpc,
} from "@/lib/procurementHubCache";
import { patchDashboardProcurementDelta } from "@/lib/dashboardStatsCache";
import { patchWarehouseHubFromPackList } from "@/lib/warehouseHubCache";
import { readSkuStockCache } from "@/lib/inventoryCatalogCache";
import { patchReportsOverviewDelta } from "@/lib/reportsCache";
import { SKU_LIST_QUERY_KEY } from "@/hooks/useSkus";
import { patchMaterialListAfterProcurementCreate } from "@/lib/materialListCache";
import type { PackSession } from "@/hooks/usePackJobs";
import {
  patchSalesQuoteDetailSeed,
  patchSalesQuotesPrepend,
  patchSalesQuoteStatus,
  SALES_QUOTES_QUERY_KEY,
} from "@/lib/salesQuotesCache";
import type { SalesQuoteRow } from "@/lib/salesQuoteListFilters";
import { formatSupabaseError } from "@/lib/supabaseErrors";
import { supabase } from "@/lib/supabase";
import { enqueueOfflineMutation } from "@/lib/offlineMutationQueue";
import {
  applyReceiveProcurementSuccess,
  buildOfflineReceiveProcurementResult,
  executeReceiveProcurementRpc,
} from "@/lib/procurementOfflineMutations";

export type { ProcurementRequestRow };

export async function fetchProcurementHub(): Promise<ProcurementHub> {
  const { data, error } = await supabase().rpc("get_procurement_hub");
  if (error) throw error;
  return mapProcurementHubFromRpc(data as ProcurementHubRpc);
}

export function useProcurementHub() {
  return useQuery({
    queryKey: PROCUREMENT_HUB_QUERY_KEY,
    queryFn: fetchProcurementHub,
  });
}

export function useProcurementRequests() {
  const query = useProcurementHub();
  return {
    ...query,
    data: query.data?.requests,
  };
}

export function useCreateProcurementRequest() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      skuId: string;
      qtyNeeded: number;
      cspoId?: string;
      listItemId?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase().rpc("create_procurement_request", {
        p_sku_id: input.skuId,
        p_qty_needed: input.qtyNeeded,
        p_cspo_id: input.cspoId ?? null,
        p_list_item_id: input.listItemId ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw new Error(formatSupabaseError(error));
      return { requestId: data as string, input };
    },
    onSuccess: ({ requestId, input }) => {
      patchDashboardProcurementDelta(qc, 1);
      patchReportsOverviewDelta(qc, "procurementLagCount", 1);

      const skuFromList = qc
        .getQueryData<Array<{ id: string; sku_code: string; name: string }>>(SKU_LIST_QUERY_KEY)
        ?.find((row) => row.id === input.skuId);
      const skuFromStock = readSkuStockCache(qc)?.find((row) => row.sku_id === input.skuId);
      const sku = skuFromList
        ? { id: skuFromList.id, sku_code: skuFromList.sku_code, name: skuFromList.name }
        : skuFromStock
          ? { id: skuFromStock.sku_id, sku_code: skuFromStock.sku_code, name: skuFromStock.name }
          : null;

      const packSession = input.cspoId
        ? qc.getQueryData<PackSession>(["pack-session", input.cspoId])
        : undefined;
      const cspoNumber = packSession?.cspo.cspo_number ?? null;

      patchProcurementHubAfterCreate(
        qc,
        buildProcurementRequestRow(requestId, {
          skuId: input.skuId,
          qtyNeeded: input.qtyNeeded,
          notes: input.notes,
          sku,
          cspoNumber,
        }),
      );

      if (input.cspoId && input.listItemId) {
        patchPackSessionAfterProcurementCreate(
          qc,
          input.cspoId,
          input.listItemId,
          requestId,
          input.qtyNeeded,
        );
        patchMaterialListAfterProcurementCreate(qc, input.cspoId, input.listItemId);
        const updatedSession = qc.getQueryData<PackSession>(["pack-session", input.cspoId]);
        if (updatedSession) {
          patchWarehouseHubFromPackList(qc, input.cspoId, updatedSession.list);
        }
      }
    },
  });
}

export function useReceiveProcurement() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { requestId: string; qty: number }) => {
      if (!navigator.onLine) {
        enqueueOfflineMutation({
          id: crypto.randomUUID(),
          type: "receive-procurement",
          payload: vars,
          createdAt: Date.now(),
        });
        return buildOfflineReceiveProcurementResult(qc, vars);
      }
      return executeReceiveProcurementRpc(vars);
    },
    onSuccess: (data) => {
      applyReceiveProcurementSuccess(qc, data);
    },
  });
}

export async function fetchSalesQuotes() {
  const { data, error } = await supabase()
    .from("sales_quotes")
    .select(`
      id, quote_number, total, currency, status, valid_until, created_at,
      vessel:vessels(name, fleet:fleets(name))
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export function useSalesQuotes() {
  return useQuery({
    queryKey: SALES_QUOTES_QUERY_KEY,
    queryFn: fetchSalesQuotes,
  });
}

export async function fetchSalesQuote(quoteId: string) {
  const [quoteRes, linesRes] = await Promise.all([
    supabase()
      .from("sales_quotes")
      .select(`
        id, quote_number, total, currency, status, valid_until, created_at, updated_at,
        vessel:vessels(name, fleet:fleets(name))
      `)
      .eq("id", quoteId)
      .single(),
    supabase()
      .from("sales_quote_lines")
      .select(`
        id, qty, unit_price,
        sku:skus(sku_code, name)
      `)
      .eq("quote_id", quoteId)
      .order("created_at"),
  ]);

  if (quoteRes.error) throw quoteRes.error;
  if (linesRes.error) throw linesRes.error;

  return { quote: quoteRes.data, lines: linesRes.data ?? [] };
}

export function useSalesQuote(quoteId: string) {
  return useQuery({
    queryKey: ["sales-quotes", quoteId],
    enabled: !!quoteId,
    queryFn: () => fetchSalesQuote(quoteId),
  });
}

export function useUpdateSalesQuoteStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      quoteId,
      status,
    }: {
      quoteId: string;
      status: "draft" | "sent" | "accepted" | "rejected" | "expired";
    }) => {
      const { error } = await supabase()
        .from("sales_quotes")
        .update({ status })
        .eq("id", quoteId);
      if (error) throw new Error(formatSupabaseError(error));
      return { quoteId, status };
    },
    onSuccess: ({ quoteId, status }) => {
      patchSalesQuoteStatus(qc, quoteId, status);
    },
  });
}

export type CreateSalesQuoteInput = {
  quote_number: string;
  vessel_id?: string;
  valid_until?: string;
  currency: string;
  lines: Array<{ sku_id: string; qty: number; unit_price: number }>;
};

export function useCreateSalesQuote() {
  const { profile } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSalesQuoteInput) => {
      if (!profile) throw new Error("Not authenticated");
      if (!input.lines.length) throw new Error("Add at least one line item");

      const total = input.lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0);

      const { data: quote, error: quoteErr } = await supabase()
        .from("sales_quotes")
        .insert({
          org_id: profile.org_id,
          quote_number: input.quote_number.trim(),
          vessel_id: input.vessel_id || null,
          valid_until: input.valid_until || null,
          total,
          currency: input.currency,
          created_by: profile.id,
        })
        .select(`
          id, quote_number, total, currency, status, valid_until, created_at,
          vessel:vessels(name, fleet:fleets(name))
        `)
        .single();

      if (quoteErr) throw quoteErr;

      const { data: insertedLines, error: linesErr } = await supabase()
        .from("sales_quote_lines")
        .insert(
          input.lines.map((line) => ({
            org_id: profile.org_id,
            quote_id: quote.id,
            sku_id: line.sku_id,
            qty: line.qty,
            unit_price: line.unit_price,
          })),
        )
        .select(`
          id, qty, unit_price,
          sku:skus(sku_code, name)
        `);

      if (linesErr) throw linesErr;

      const vesselRaw = quote.vessel as unknown;
      const vessel = Array.isArray(vesselRaw)
        ? vesselRaw[0]
        : vesselRaw;

      const listRow = {
        id: quote.id,
        quote_number: quote.quote_number,
        total: Number(quote.total),
        currency: quote.currency,
        status: quote.status,
        valid_until: quote.valid_until,
        created_at: quote.created_at,
        vessel,
      } satisfies SalesQuoteRow;

      return {
        listRow,
        detail: {
          quote: {
            ...quote,
            total: Number(quote.total),
            updated_at: quote.created_at,
            vessel,
          },
          lines: insertedLines ?? [],
        },
      };
    },
    onSuccess: ({ listRow, detail }) => {
      patchSalesQuotesPrepend(qc, listRow);
      patchSalesQuoteDetailSeed(qc, listRow.id, detail);
    },
  });
}
