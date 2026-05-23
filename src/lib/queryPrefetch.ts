import type { QueryClient } from "@tanstack/react-query";
import {
  CSPO_DETAIL_SESSION_QUERY_KEY,
  fetchCspoDetailSession,
  fetchCspos,
} from "@/hooks/useCspos";
import {
  DASHBOARD_STATS_QUERY_KEY,
  fetchDashboardStats,
} from "@/hooks/useDashboardStats";
import {
  fetchOnboardHub,
  fetchReceiveSession,
  fetchReturnsSession,
  fetchUsageLogSession,
} from "@/hooks/useOnboard";
import { fetchPackSession, fetchPackingDocs, fetchWarehouseHub } from "@/hooks/usePackJobs";
import {
  fetchProcurementHub,
  fetchSalesQuote,
  fetchSalesQuotes,
} from "@/hooks/useProcurement";
import { fetchProposal, fetchProposals } from "@/hooks/useProposals";
import {
  AUDIT_EVENTS_QUERY_KEY,
  BOOKKEEPER_REPORT_QUERY_KEY,
  CSPO_PNL_REPORT_QUERY_KEY,
  fetchAuditEvents,
  fetchBookkeeperPerformanceReport,
  fetchCspoPnlReport,
  fetchFleetComparisonReport,
  fetchMaterialInstanceSearch,
  fetchMaterialTrace,
  fetchProcurementLagReport,
  fetchReportsOverview,
  fetchSkuConsumptionReport,
  fetchTransferAudit,
  fetchVesselSpendReport,
  FLEET_COMPARISON_REPORT_QUERY_KEY,
  materialInstanceSearchQueryKey,
  materialTraceQueryKey,
  PROCUREMENT_LAG_REPORT_QUERY_KEY,
  REPORT_STALE_MS,
  REPORTS_OVERVIEW_QUERY_KEY,
  SKU_CONSUMPTION_REPORT_QUERY_KEY,
  TRANSFER_AUDIT_QUERY_KEY,
  VESSEL_SPEND_REPORT_QUERY_KEY,
} from "@/hooks/useReports";
import {
  cspoBlockingInventoryQueryKey,
  closureReportQueryKey,
  fetchClosureReport,
  fetchCspoBlockingInventory,
  fetchReturnReceiptJobs,
} from "@/hooks/useClosure";
import { fetchMaterialList, materialListQueryKey } from "@/hooks/useMaterialList";
import {
  fetchOutboundPendingTransfers,
  outboundPendingTransfersQueryKey,
} from "@/hooks/useOnboard";
import { fetchInventoryCatalogHub, fetchSkuList, SKU_LIST_QUERY_KEY } from "@/hooks/useSkus";
import { fetchMaterialInstances } from "@/hooks/useInventory";
import { fetchVessels } from "@/hooks/useVessels";
import { CSPO_LIST_QUERY_KEY } from "@/lib/cspoListCache";
import { INVENTORY_CATALOG_QUERY_KEY } from "@/lib/inventoryCatalogCache";
import { materialInstancesQueryKey } from "@/lib/materialInstancesCache";
import {
  canWorkAboard,
  ONBOARD_HUB_QUERY_KEY,
  type OnboardJob,
} from "@/lib/onboardHubCache";
import { PROCUREMENT_HUB_QUERY_KEY } from "@/lib/procurementHubCache";
import { PROPOSALS_QUERY_KEY } from "@/lib/proposalsCache";
import { SALES_QUOTES_QUERY_KEY } from "@/lib/salesQuotesCache";
import { WAREHOUSE_HUB_QUERY_KEY } from "@/lib/warehouseHubCache";
import { LIVE_PATCHED_STALE_MS } from "@/lib/queryStaleTimes";

export type OnboardSessionTarget = "receive" | "log" | "returns" | "detail";

function prefetch<T>(
  qc: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  void qc.prefetchQuery(cachedQueryOptions(queryKey, queryFn));
}

function cachedQueryOptions<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  return { queryKey, queryFn, staleTime: LIVE_PATCHED_STALE_MS };
}

function ensure<T>(
  qc: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  return qc.ensureQueryData(cachedQueryOptions(queryKey, queryFn));
}

export function ensureReceiveSession(qc: QueryClient, cspoId: string) {
  return ensure(qc, ["receive-session", cspoId], () => fetchReceiveSession(cspoId));
}

export function ensureUsageLogSession(qc: QueryClient, cspoId: string) {
  return ensure(qc, ["usage-log-session", cspoId], () => fetchUsageLogSession(cspoId));
}

export function ensureReturnsSession(qc: QueryClient, cspoId: string) {
  return ensure(qc, ["returns-session", cspoId], () => fetchReturnsSession(cspoId));
}

export function ensureCspoDetailSession(qc: QueryClient, cspoId: string) {
  return ensure(
    qc,
    [CSPO_DETAIL_SESSION_QUERY_KEY, cspoId],
    () => fetchCspoDetailSession(cspoId),
  );
}

export function ensurePackSession(qc: QueryClient, cspoId: string) {
  return ensure(qc, ["pack-session", cspoId], () => fetchPackSession(cspoId));
}

export function ensurePackingDocs(qc: QueryClient, cspoId: string) {
  return ensure(qc, ["packing-docs", cspoId], () => fetchPackingDocs(cspoId));
}

export function ensureProposalDetail(qc: QueryClient, proposalId: string) {
  return ensure(qc, ["proposals", proposalId], () => fetchProposal(proposalId));
}

export function ensureSalesQuoteDetail(qc: QueryClient, quoteId: string) {
  return ensure(qc, ["sales-quotes", quoteId], () => fetchSalesQuote(quoteId));
}

export function ensureMaterialList(qc: QueryClient, cspoId: string) {
  return ensure(qc, materialListQueryKey(cspoId), () => fetchMaterialList(cspoId));
}

export function ensureClosureReport(qc: QueryClient, cspoId: string) {
  return ensure(qc, closureReportQueryKey(cspoId), () => fetchClosureReport(cspoId));
}

export function ensureCspoBlockingInventory(qc: QueryClient, cspoId: string) {
  return ensure(
    qc,
    cspoBlockingInventoryQueryKey(cspoId),
    () => fetchCspoBlockingInventory(cspoId),
  );
}

export function ensureOutboundPendingTransfers(qc: QueryClient, cspoId: string) {
  return ensure(
    qc,
    outboundPendingTransfersQueryKey(cspoId),
    () => fetchOutboundPendingTransfers(cspoId),
  );
}

export function ensureCspoDetailPage(qc: QueryClient, cspoId: string) {
  return Promise.all([
    ensureCspoDetailSession(qc, cspoId),
    ensureMaterialList(qc, cspoId),
  ]).then(() =>
    Promise.allSettled([
      ensureClosureReport(qc, cspoId),
      ensureCspoBlockingInventory(qc, cspoId),
      ensureOutboundPendingTransfers(qc, cspoId),
    ]),
  );
}

export function ensureDashboardStats(qc: QueryClient) {
  return ensure(qc, DASHBOARD_STATS_QUERY_KEY, fetchDashboardStats);
}

export function ensureCspoList(qc: QueryClient) {
  return ensure(qc, CSPO_LIST_QUERY_KEY, fetchCspos);
}

export function ensureOnboardHub(qc: QueryClient) {
  return ensure(qc, ONBOARD_HUB_QUERY_KEY, fetchOnboardHub);
}

export function ensureWarehouseHub(qc: QueryClient) {
  return ensure(qc, WAREHOUSE_HUB_QUERY_KEY, fetchWarehouseHub);
}

/** Warehouse hub + restock queue — used by the warehouse index route loader. */
export function ensureWarehouseHubPage(qc: QueryClient) {
  return Promise.all([ensureWarehouseHub(qc), ensureReturnRestockJobs(qc)]);
}

export function ensureProcurementHub(qc: QueryClient) {
  return ensure(qc, PROCUREMENT_HUB_QUERY_KEY, fetchProcurementHub);
}

export function ensureInventoryHub(qc: QueryClient) {
  return Promise.all([
    ensure(qc, INVENTORY_CATALOG_QUERY_KEY, fetchInventoryCatalogHub),
    ensure(qc, SKU_LIST_QUERY_KEY, fetchSkuList),
  ]);
}

export function ensureMaterialInstances(qc: QueryClient, status?: string) {
  return ensure(
    qc,
    materialInstancesQueryKey(status),
    () => fetchMaterialInstances(status),
  );
}

export function prefetchMaterialInstances(qc: QueryClient, status?: string) {
  prefetch(
    qc,
    materialInstancesQueryKey(status),
    () => fetchMaterialInstances(status),
  );
}

export function prefetchMaterialTrace(qc: QueryClient, instanceId: string) {
  if (!instanceId) return;
  prefetchReport(
    qc,
    materialTraceQueryKey(instanceId),
    () => fetchMaterialTrace(instanceId),
  );
}

export function prefetchMaterialInstanceSearch(qc: QueryClient, query: string) {
  if (query.trim().length < 2) return;
  prefetchReport(
    qc,
    materialInstanceSearchQueryKey(query),
    () => fetchMaterialInstanceSearch(query),
  );
}

export function ensureReportsOverview(qc: QueryClient) {
  return ensureReport(qc, REPORTS_OVERVIEW_QUERY_KEY, fetchReportsOverview);
}

export function ensureVessels(qc: QueryClient) {
  return ensure(qc, ["vessels"], fetchVessels);
}

export function ensureFormPickers(qc: QueryClient) {
  return Promise.all([ensureVessels(qc), ensure(qc, SKU_LIST_QUERY_KEY, fetchSkuList)]);
}

export function ensureProposalsHub(qc: QueryClient) {
  return Promise.all([
    ensure(qc, PROPOSALS_QUERY_KEY, fetchProposals),
    ensureFormPickers(qc),
  ]);
}

export function ensureSalesQuotesHub(qc: QueryClient) {
  return Promise.all([
    ensure(qc, SALES_QUOTES_QUERY_KEY, fetchSalesQuotes),
    ensureFormPickers(qc),
  ]);
}

export function ensureReturnRestockJobs(qc: QueryClient) {
  return ensure(qc, ["return-receipt-jobs"], fetchReturnReceiptJobs);
}

export type ReportTabId =
  | "pnl"
  | "transfers"
  | "vessels"
  | "fleets"
  | "skus"
  | "procurement"
  | "bookkeepers"
  | "audit";

function reportQueryOptions<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  return { queryKey, queryFn, staleTime: REPORT_STALE_MS };
}

function prefetchReport<T>(
  qc: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  void qc.prefetchQuery(reportQueryOptions(queryKey, queryFn));
}

function ensureReport<T>(
  qc: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  return qc.ensureQueryData(reportQueryOptions(queryKey, queryFn));
}

export function prefetchReportTab(qc: QueryClient, tab: ReportTabId) {
  switch (tab) {
    case "pnl":
      prefetchReport(qc, CSPO_PNL_REPORT_QUERY_KEY, fetchCspoPnlReport);
      break;
    case "transfers":
      prefetchReport(qc, TRANSFER_AUDIT_QUERY_KEY, fetchTransferAudit);
      break;
    case "vessels":
      prefetchReport(qc, VESSEL_SPEND_REPORT_QUERY_KEY, fetchVesselSpendReport);
      break;
    case "fleets":
      prefetchReport(qc, FLEET_COMPARISON_REPORT_QUERY_KEY, fetchFleetComparisonReport);
      break;
    case "skus":
      prefetchReport(qc, SKU_CONSUMPTION_REPORT_QUERY_KEY, fetchSkuConsumptionReport);
      break;
    case "procurement":
      prefetchReport(qc, PROCUREMENT_LAG_REPORT_QUERY_KEY, fetchProcurementLagReport);
      break;
    case "bookkeepers":
      prefetchReport(qc, BOOKKEEPER_REPORT_QUERY_KEY, fetchBookkeeperPerformanceReport);
      break;
    case "audit":
      prefetchReport(qc, AUDIT_EVENTS_QUERY_KEY, fetchAuditEvents);
      break;
  }
}

export function ensureReportsHub(qc: QueryClient) {
  return Promise.all([
    ensureReportsOverview(qc),
    ensureReport(qc, CSPO_PNL_REPORT_QUERY_KEY, fetchCspoPnlReport),
  ]);
}

export function prefetchFormPickers(qc: QueryClient) {
  prefetch(qc, ["vessels"], fetchVessels);
  prefetch(qc, SKU_LIST_QUERY_KEY, fetchSkuList);
}

export function prefetchNewCspoForm(qc: QueryClient) {
  prefetch(qc, ["vessels"], fetchVessels);
}

export function prefetchOnboardHub(qc: QueryClient) {
  prefetch(qc, ONBOARD_HUB_QUERY_KEY, fetchOnboardHub);
}

export function prefetchWarehouseHub(qc: QueryClient) {
  prefetch(qc, WAREHOUSE_HUB_QUERY_KEY, fetchWarehouseHub);
  prefetchReturnRestockJobs(qc);
}

export function prefetchProcurementHub(qc: QueryClient) {
  prefetch(qc, PROCUREMENT_HUB_QUERY_KEY, fetchProcurementHub);
}

export function prefetchDashboardStats(qc: QueryClient) {
  prefetch(qc, DASHBOARD_STATS_QUERY_KEY, fetchDashboardStats);
}

export function prefetchCspoList(qc: QueryClient) {
  prefetch(qc, CSPO_LIST_QUERY_KEY, fetchCspos);
}

export function prefetchInventoryHub(qc: QueryClient) {
  prefetch(qc, INVENTORY_CATALOG_QUERY_KEY, fetchInventoryCatalogHub);
  prefetch(qc, SKU_LIST_QUERY_KEY, fetchSkuList);
  prefetchMaterialInstances(qc);
}

export function prefetchReportsOverview(qc: QueryClient) {
  prefetchReport(qc, REPORTS_OVERVIEW_QUERY_KEY, fetchReportsOverview);
  prefetchReport(qc, CSPO_PNL_REPORT_QUERY_KEY, fetchCspoPnlReport);
}

export function prefetchProposalsList(qc: QueryClient) {
  prefetch(qc, PROPOSALS_QUERY_KEY, fetchProposals);
  prefetch(qc, ["vessels"], fetchVessels);
  prefetch(qc, SKU_LIST_QUERY_KEY, fetchSkuList);
}

export function prefetchSalesQuotesList(qc: QueryClient) {
  prefetch(qc, SALES_QUOTES_QUERY_KEY, fetchSalesQuotes);
  prefetch(qc, ["vessels"], fetchVessels);
  prefetch(qc, SKU_LIST_QUERY_KEY, fetchSkuList);
}

export function prefetchProposalDetail(qc: QueryClient, proposalId: string) {
  prefetch(qc, ["proposals", proposalId], () => fetchProposal(proposalId));
}

export function prefetchSalesQuoteDetail(qc: QueryClient, quoteId: string) {
  prefetch(qc, ["sales-quotes", quoteId], () => fetchSalesQuote(quoteId));
}

export function prefetchReturnRestockJobs(qc: QueryClient) {
  prefetch(qc, ["return-receipt-jobs"], fetchReturnReceiptJobs);
}

export function prefetchMaterialList(qc: QueryClient, cspoId: string) {
  prefetch(qc, materialListQueryKey(cspoId), () => fetchMaterialList(cspoId));
}

export function prefetchClosureReport(qc: QueryClient, cspoId: string) {
  prefetch(qc, closureReportQueryKey(cspoId), () => fetchClosureReport(cspoId));
}

export function prefetchCspoBlockingInventory(qc: QueryClient, cspoId: string) {
  prefetch(
    qc,
    cspoBlockingInventoryQueryKey(cspoId),
    () => fetchCspoBlockingInventory(cspoId),
  );
}

export function prefetchOutboundPendingTransfers(qc: QueryClient, cspoId: string) {
  prefetch(
    qc,
    outboundPendingTransfersQueryKey(cspoId),
    () => fetchOutboundPendingTransfers(cspoId),
  );
}

export function prefetchCspoDetailPage(qc: QueryClient, cspoId: string) {
  prefetchCspoDetailSession(qc, cspoId);
  prefetchMaterialList(qc, cspoId);
  prefetchClosureReport(qc, cspoId);
  prefetchCspoBlockingInventory(qc, cspoId);
  prefetchOutboundPendingTransfers(qc, cspoId);
}

export function prefetchReceiveSession(qc: QueryClient, cspoId: string) {
  prefetch(qc, ["receive-session", cspoId], () => fetchReceiveSession(cspoId));
}

export function prefetchUsageLogSession(qc: QueryClient, cspoId: string) {
  prefetch(qc, ["usage-log-session", cspoId], () => fetchUsageLogSession(cspoId));
}

export function prefetchReturnsSession(qc: QueryClient, cspoId: string) {
  prefetch(qc, ["returns-session", cspoId], () => fetchReturnsSession(cspoId));
}

export function prefetchCspoDetailSession(qc: QueryClient, cspoId: string) {
  prefetch(
    qc,
    [CSPO_DETAIL_SESSION_QUERY_KEY, cspoId],
    () => fetchCspoDetailSession(cspoId),
  );
}

export function prefetchPackSession(qc: QueryClient, cspoId: string) {
  prefetch(qc, ["pack-session", cspoId], () => fetchPackSession(cspoId));
}

export function prefetchPackingDocs(qc: QueryClient, cspoId: string) {
  if (!cspoId) return;
  prefetch(qc, ["packing-docs", cspoId], () => fetchPackingDocs(cspoId));
}

/** Prefetch the session RPC most likely needed for an onboard hub job card. */
export function prefetchOnboardJobCard(qc: QueryClient, job: OnboardJob) {
  if (job.pending_receipts > 0) {
    prefetchReceiveSession(qc, job.cspo_id);
    return;
  }
  if (canWorkAboard(job.status) || job.items_on_vessel > 0) {
    prefetchUsageLogSession(qc, job.cspo_id);
    prefetchReturnsSession(qc, job.cspo_id);
    return;
  }
  if (job.next_step === "pack" || job.next_step === "receive_empty") {
    prefetchPackSession(qc, job.cspo_id);
  }
}

export function prefetchOnboardSession(
  qc: QueryClient,
  cspoId: string,
  target: OnboardSessionTarget,
) {
  switch (target) {
    case "receive":
      prefetchReceiveSession(qc, cspoId);
      break;
    case "log":
      prefetchUsageLogSession(qc, cspoId);
      break;
    case "returns":
      prefetchReturnsSession(qc, cspoId);
      break;
    case "detail":
      prefetchCspoDetailPage(qc, cspoId);
      break;
  }
}

const SIDEBAR_PREFETCH: Record<string, (qc: QueryClient) => void> = {
  "/": prefetchDashboardStats,
  "/cspos": prefetchCspoList,
  "/proposals": prefetchProposalsList,
  "/sales-quotes": prefetchSalesQuotesList,
  "/inventory": prefetchInventoryHub,
  "/procurement": prefetchProcurementHub,
  "/warehouse": prefetchWarehouseHub,
  "/onboard": prefetchOnboardHub,
  "/reports": prefetchReportsOverview,
};

export function prefetchSidebarRoute(qc: QueryClient, to: string) {
  SIDEBAR_PREFETCH[to]?.(qc);
}

/** Prefetch the session RPC likely needed for a CSPO quick-action link. */
export function prefetchCspoQuickAction(
  qc: QueryClient,
  to: string,
  cspoId: string,
) {
  if (to.includes("/warehouse/pack/")) {
    prefetchPackSession(qc, cspoId);
    return;
  }
  if (to.includes("/warehouse/docs/")) {
    prefetchPackingDocs(qc, cspoId);
    return;
  }
  if (to.includes("/onboard/receive/")) {
    prefetchReceiveSession(qc, cspoId);
    return;
  }
  if (to.includes("/onboard/log/")) {
    prefetchUsageLogSession(qc, cspoId);
    return;
  }
  if (to.includes("/onboard/returns/")) {
    prefetchReturnsSession(qc, cspoId);
  }
}
