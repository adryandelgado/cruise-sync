import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  exportCsv,
  useAuditEvents,
  useBookkeeperPerformanceReport,
  useCspoPnlReport,
  useFleetComparisonReport,
  useMaterialInstanceSearch,
  useMaterialTrace,
  useProcurementLagReport,
  useReportsOverview,
  useSkuConsumptionReport,
  useTransferAudit,
  useVesselSpendReport,
  type ReportsOverview,
} from "@/hooks/useReports";
import { formatCurrency } from "@/lib/utils";
import {
  ensureReportsHub,
  prefetchMaterialInstanceSearch,
  prefetchMaterialTrace,
  prefetchReportTab,
  type ReportTabId,
} from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

export const Route = createFileRoute("/_authed/reports/")({
  loader: ({ context: { queryClient } }) => ensureReportsHub(queryClient),
  component: ReportsPage,
});

type Tab = ReportTabId | "trace";

const TABS: { id: Tab; label: string; countKey?: keyof ReportsOverview }[] = [
  { id: "pnl", label: "CSPO P&L", countKey: "pnlCount" },
  { id: "transfers", label: "Transfer audit", countKey: "transferCount" },
  { id: "vessels", label: "Vessel spend", countKey: "vesselCount" },
  { id: "fleets", label: "Fleet comparison", countKey: "fleetCount" },
  { id: "skus", label: "SKU consumption", countKey: "skuCount" },
  { id: "procurement", label: "Procurement lag", countKey: "procurementLagCount" },
  { id: "bookkeepers", label: "Bookkeepers", countKey: "bookkeeperCount" },
  { id: "trace", label: "Material trace" },
  { id: "audit", label: "Audit log", countKey: "auditCount" },
];

function ReportsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("pnl");
  const { data: overview } = useReportsOverview();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-stone-400">
          Analytics layer — the reports Zoho+Monday+Inflow can&apos;t produce.
        </p>
        {overview && (
          <p className="mt-2 text-xs text-stone-500">
            {overview.pnlCount} CSPOs in P&amp;L · {overview.transferCount} transfers ·{" "}
            {overview.vesselCount} vessels tracked
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-2 border-b border-stone-800 pb-2">
        {TABS.map(({ id, label, countKey }) => {
          const count = countKey && overview ? overview[countKey] : 0;
          return (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            onMouseEnter={() => {
              if (id !== "trace") prefetchReportTab(qc, id);
            }}
            onFocus={() => {
              if (id !== "trace") prefetchReportTab(qc, id);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
              tab === id
                ? "bg-stone-800 text-stone-100"
                : "text-stone-500 hover:text-stone-300"
            }`}
          >
            {label}
            {countKey && count > 0 && (
              <Badge variant="draft" className="px-1.5 py-0 text-[10px]">
                {count}
              </Badge>
            )}
          </button>
          );
        })}
      </div>

      {tab === "pnl" && <CspoPnlTab />}
      {tab === "transfers" && <TransferAuditTab />}
      {tab === "vessels" && <VesselSpendTab />}
      {tab === "fleets" && <FleetComparisonTab />}
      {tab === "skus" && <SkuConsumptionTab />}
      {tab === "procurement" && <ProcurementLagTab />}
      {tab === "bookkeepers" && <BookkeeperTab />}
      {tab === "trace" && <MaterialTraceTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function CspoPnlTab() {
  const { data: pnl, isPending, error } = useCspoPnlReport();
  const loading = isInitialQueryLoad(isPending, pnl);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (pnl ?? []).filter((r) => {
      if (!q) return true;
      return r.cspo_number.toUpperCase().includes(q);
    });
  }, [pnl, search]);

  function exportPnl() {
    if (!filtered.length) return;
    exportCsv(
      "cspo-pnl.csv",
      ["PO", "Status", "Original", "Consumed", "Returned", "XferOut", "Open", "Variance%"],
      filtered.map((r) => [
        r.cspo_number,
        r.status,
        String(r.original_value),
        String(Number(r.consumed_value) + Number(r.installed_value)),
        String(r.returned_value),
        String(r.transferred_out_value),
        String(r.open_balance),
        String(r.variance_pct),
      ]),
    );
  }

  return (
    <ReportSection
      title="CSPO P&L"
      onExport={filtered.length ? exportPnl : undefined}
      loading={loading}
      error={error}
      empty={!loading && !error && (pnl?.length ?? 0) === 0}
      emptyMessage="No closed or in-progress CSPOs in the closure report yet."
    >
      {(pnl?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter by PO #…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">{filtered.length} rows</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No rows match your filter</p>
          ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
            <th className="px-4 py-3">PO #</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Original</th>
            <th className="px-4 py-3 text-right">Consumed</th>
            <th className="px-4 py-3 text-right">Returned</th>
            <th className="px-4 py-3 text-right">Xfer out</th>
            <th className="px-4 py-3 text-right">Open</th>
            <th className="px-4 py-3 text-right">Variance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {filtered.map((row) => (
            <tr key={row.cspo_id}>
              <td className="px-4 py-3 font-mono text-brand-400">
                <Link to="/cspos/$cspoId" params={{ cspoId: row.cspo_id }}>
                  {row.cspo_number}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Badge variant={row.status as Parameters<typeof Badge>[0]["variant"]}>
                  {statusLabel(row.status)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {formatCurrency(Number(row.original_value), row.currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-amber-400">
                {formatCurrency(Number(row.consumed_value) + Number(row.installed_value), row.currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sky-400">
                {formatCurrency(Number(row.returned_value), row.currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-violet-400">
                {formatCurrency(Number(row.transferred_out_value), row.currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-400">
                {formatCurrency(Number(row.open_balance), row.currency)}
              </td>
              <td className="px-4 py-3 text-right font-mono">{row.variance_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
          )}
        </>
      )}
    </ReportSection>
  );
}

function TransferAuditTab() {
  const { data: transfers, isPending, error } = useTransferAudit();
  const loading = isInitialQueryLoad(isPending, transfers);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return transfers ?? [];
    return (transfers ?? []).filter((t) =>
      t.sku_code.toUpperCase().includes(q) ||
      t.sku_name.toUpperCase().includes(q) ||
      t.from_cspo.toUpperCase().includes(q) ||
      t.to_cspo.toUpperCase().includes(q),
    );
  }, [transfers, search]);

  return (
    <ReportSection
      title="Transfer audit"
      loading={loading}
      error={error}
      empty={!loading && !error && (transfers?.length ?? 0) === 0}
      emptyMessage="No transfer events recorded yet."
    >
      {(transfers?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-4">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter SKU or PO #…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">{filtered.length} rows</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No transfers match your filter</p>
          ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Item</th>
            <th className="px-4 py-3">From → To</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3">Ack</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {filtered.map((t) => (
            <tr key={t.transfer_id}>
              <td className="px-4 py-3 text-stone-400">
                {new Date(t.initiated_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">{t.sku_code} — {t.sku_name}</td>
              <td className="px-4 py-3 font-mono text-stone-400">
                {t.from_cspo} → {t.to_cspo}
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {formatCurrency(Number(t.transferred_value), t.currency)}
              </td>
              <td className="px-4 py-3">{t.acknowledged_at ? "✓" : "Pending"}</td>
            </tr>
          ))}
        </tbody>
      </table>
          )}
        </>
      )}
    </ReportSection>
  );
}

function VesselSpendTab() {
  const { data, isPending, error } = useVesselSpendReport();
  const loading = isInitialQueryLoad(isPending, data);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (r) =>
        r.vessel_name.toUpperCase().includes(q) ||
        (r.fleet_name?.toUpperCase().includes(q) ?? false),
    );
  }, [data, search]);

  return (
    <ReportSection
      title="Vessel lifetime spend"
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.length ?? 0) === 0}
      emptyMessage="No vessel spend data yet — close CSPOs to populate analytics."
    >
      {(data?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-4">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter vessel or fleet…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">{filtered.length} vessels</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No vessels match your filter</p>
          ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
            <th className="px-4 py-3">Vessel</th>
            <th className="px-4 py-3">Fleet</th>
            <th className="px-4 py-3 text-right">CSPOs</th>
            <th className="px-4 py-3 text-right">Issued</th>
            <th className="px-4 py-3 text-right">Consumed</th>
            <th className="px-4 py-3 text-right">Open</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {filtered.map((r) => (
            <tr key={r.vessel_id}>
              <td className="px-4 py-3 text-stone-200">{r.vessel_name}</td>
              <td className="px-4 py-3 text-stone-400">{r.fleet_name}</td>
              <td className="px-4 py-3 text-right font-mono">{r.cspo_count}</td>
              <td className="px-4 py-3 text-right font-mono">
                {formatCurrency(Number(r.total_issued_value))}
              </td>
              <td className="px-4 py-3 text-right font-mono text-amber-400">
                {formatCurrency(Number(r.total_consumed_value))}
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-400">
                {formatCurrency(Number(r.total_open_balance))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
          )}
        </>
      )}
    </ReportSection>
  );
}

function FleetComparisonTab() {
  const { data, isPending, error } = useFleetComparisonReport();
  const loading = isInitialQueryLoad(isPending, data);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((r) => r.fleet_name.toUpperCase().includes(q));
  }, [data, search]);

  return (
    <ReportSection
      title="Fleet comparison"
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.length ?? 0) === 0}
      emptyMessage="No fleet analytics yet — close CSPOs across fleets to populate."
    >
      {(data?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-4">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter fleet…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">{filtered.length} fleets</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No fleets match your filter</p>
          ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
            <th className="px-4 py-3">Fleet</th>
            <th className="px-4 py-3 text-right">Vessels</th>
            <th className="px-4 py-3 text-right">CSPOs</th>
            <th className="px-4 py-3 text-right">Avg job $</th>
            <th className="px-4 py-3 text-right">Avg variance</th>
            <th className="px-4 py-3 text-right">Return rate</th>
            <th className="px-4 py-3 text-right">Transfers</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {filtered.map((r) => (
            <tr key={r.fleet_id}>
              <td className="px-4 py-3 text-stone-200">{r.fleet_name}</td>
              <td className="px-4 py-3 text-right font-mono">{r.vessel_count}</td>
              <td className="px-4 py-3 text-right font-mono">{r.cspo_count}</td>
              <td className="px-4 py-3 text-right font-mono">
                {formatCurrency(Number(r.avg_closed_job_value))}
              </td>
              <td className="px-4 py-3 text-right font-mono">{Number(r.avg_variance_pct).toFixed(1)}%</td>
              <td className="px-4 py-3 text-right font-mono">{Number(r.avg_return_rate_pct).toFixed(1)}%</td>
              <td className="px-4 py-3 text-right font-mono">{r.transfer_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
          )}
        </>
      )}
    </ReportSection>
  );
}

function SkuConsumptionTab() {
  const { data, isPending, error } = useSkuConsumptionReport();
  const loading = isInitialQueryLoad(isPending, data);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (r) =>
        r.sku_code.toUpperCase().includes(q) ||
        r.sku_name.toUpperCase().includes(q) ||
        (r.category?.toUpperCase().includes(q) ?? false),
    );
  }, [data, search]);

  return (
    <ReportSection
      title="SKU consumption heatmap"
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.length ?? 0) === 0}
      emptyMessage="No consumption data yet — log usage aboard to populate."
    >
      {(data?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-4">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter SKU or category…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">{filtered.length} SKUs</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No SKUs match your filter</p>
          ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3 text-right">Consumed</th>
            <th className="px-4 py-3 text-right">Installed</th>
            <th className="px-4 py-3 text-right">Returns</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {filtered.map((r) => (
            <tr key={r.sku_id}>
              <td className="px-4 py-3">
                <span className="font-mono text-brand-400">{r.sku_code}</span>
                <span className="ml-2 text-stone-400">{r.sku_name}</span>
              </td>
              <td className="px-4 py-3 capitalize text-stone-500">{r.category ?? "—"}</td>
              <td className="px-4 py-3 text-right font-mono text-amber-400">{r.qty_consumed}</td>
              <td className="px-4 py-3 text-right font-mono text-emerald-400">{r.qty_installed}</td>
              <td className="px-4 py-3 text-right font-mono">{r.return_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
          )}
        </>
      )}
    </ReportSection>
  );
}

function ProcurementLagTab() {
  const { data, isPending, error } = useProcurementLagReport();
  const loading = isInitialQueryLoad(isPending, data);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (r) =>
        r.sku_code.toUpperCase().includes(q) ||
        r.sku_name.toUpperCase().includes(q) ||
        (r.cspo_number?.toUpperCase().includes(q) ?? false),
    );
  }, [data, search]);

  return (
    <ReportSection
      title="Procurement lag"
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.length ?? 0) === 0}
      emptyMessage="No procurement requests on record."
    >
      {(data?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-4">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter SKU or CSPO…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">{filtered.length} rows</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No rows match your filter</p>
          ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">CSPO</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Lag (days)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {filtered.map((r) => (
            <tr key={r.request_id}>
              <td className="px-4 py-3">{r.sku_code} — {r.sku_name}</td>
              <td className="px-4 py-3 font-mono text-stone-400">{r.cspo_number ?? "—"}</td>
              <td className="px-4 py-3">{statusLabel(r.status)}</td>
              <td className="px-4 py-3 text-right font-mono">{r.lag_days ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
          )}
        </>
      )}
    </ReportSection>
  );
}

function BookkeeperTab() {
  const { data, isPending, error } = useBookkeeperPerformanceReport();
  const loading = isInitialQueryLoad(isPending, data);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (r) =>
        r.full_name.toUpperCase().includes(q) ||
        r.email.toUpperCase().includes(q),
    );
  }, [data, search]);

  return (
    <ReportSection
      title="Bookkeeper performance"
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.length ?? 0) === 0}
      emptyMessage="No CSPOs with assigned bookkeepers yet."
    >
      {(data?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-4">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter bookkeeper…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">{filtered.length} rows</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No bookkeepers match your filter</p>
          ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
            <th className="px-4 py-3">Bookkeeper</th>
            <th className="px-4 py-3 text-right">CSPOs</th>
            <th className="px-4 py-3 text-right">Closed</th>
            <th className="px-4 py-3 text-right">Avg variance</th>
            <th className="px-4 py-3 text-right">Open balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {filtered.map((r) => (
            <tr key={r.bookkeeper_id}>
              <td className="px-4 py-3">
                <span className="text-stone-200">{r.full_name}</span>
                <span className="ml-2 text-xs text-stone-500">{r.email}</span>
              </td>
              <td className="px-4 py-3 text-right font-mono">{r.cspo_count}</td>
              <td className="px-4 py-3 text-right font-mono">{r.closed_count}</td>
              <td className="px-4 py-3 text-right font-mono">{r.avg_variance_pct}%</td>
              <td className="px-4 py-3 text-right font-mono text-emerald-400">
                {formatCurrency(r.total_open_balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
          )}
        </>
      )}
    </ReportSection>
  );
}

function MaterialTraceTab() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const { data: results, isPending: searchPending } = useMaterialInstanceSearch(debouncedQuery);
  const { data: trace, isPending: tracePending } = useMaterialTrace(selectedId);
  const searchLoading =
    debouncedQuery.length >= 2 && isInitialQueryLoad(searchPending, results);
  const traceLoading = isInitialQueryLoad(tracePending, trace);

  useEffect(() => {
    prefetchMaterialInstanceSearch(qc, debouncedQuery);
  }, [qc, debouncedQuery]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId("");
          }}
          placeholder="Search by serial, SKU code, or name…"
          className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-10 pr-3 text-sm text-stone-100 placeholder:text-stone-600"
        />
      </div>

      {query.length > 0 && query.length < 2 && (
        <p className="text-sm text-stone-500">Type at least 2 characters to search</p>
      )}

      {searchLoading && (
        <Card className="px-4 py-8 text-center text-sm text-stone-500">Searching…</Card>
      )}

      {!searchLoading && debouncedQuery.length >= 2 && results && results.length === 0 && !selectedId && (
        <Card className="px-4 py-8 text-center text-sm text-stone-500">
          No instances match “{query}”
        </Card>
      )}

      {results && results.length > 0 && !selectedId && (
        <Card className="divide-y divide-stone-800">
          {results.map((r) => {
            const sku = r.sku;
            return (
              <button
                key={r.id}
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-stone-900/40"
                onClick={() => setSelectedId(r.id)}
                onMouseEnter={() => prefetchMaterialTrace(qc, r.id)}
                onFocus={() => prefetchMaterialTrace(qc, r.id)}
              >
                <span>{sku?.name} · {sku?.sku_code}</span>
                <Badge variant="draft">{statusLabel(r.status)}</Badge>
              </button>
            );
          })}
        </Card>
      )}

      {selectedId && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId("")}>
            ← Back to search
          </Button>
        </div>
      )}

      {selectedId && traceLoading && (
        <Card className="px-4 py-8 text-center text-sm text-stone-500">Loading trace…</Card>
      )}

      {selectedId && trace && (
        <ReportSection title="Lifetime trace">
          <ol className="space-y-3 p-4 text-sm">
            {trace.map((m) => (
              <li key={m.movement_id} className="border-l-2 border-brand-800 pl-4">
                <p className="text-stone-200">
                  {m.from_status ? `${statusLabel(m.from_status)} → ` : ""}
                  {statusLabel(m.to_status ?? "")}
                </p>
                <p className="text-xs text-stone-500">
                  {m.cspo_number && `CSPO ${m.cspo_number} · `}
                  {new Date(m.occurred_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        </ReportSection>
      )}
    </div>
  );
}

function AuditTab() {
  const { data: audit, isPending, error } = useAuditEvents();
  const loading = isInitialQueryLoad(isPending, audit);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return audit ?? [];
    return (audit ?? []).filter(
      (e) =>
        e.action.toUpperCase().includes(q) ||
        e.table_name.toUpperCase().includes(q),
    );
  }, [audit, search]);

  return (
    <ReportSection
      title="Financial audit log"
      loading={loading}
      error={error}
      empty={!loading && !error && (audit?.length ?? 0) === 0}
      emptyMessage="No audit events recorded yet."
    >
      {(audit?.length ?? 0) > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 px-4 pt-4">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter action or table…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-xs text-stone-500">
              {filtered.length} of {audit!.length} (latest 50)
            </span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">No events match your filter</p>
          ) : (
      <div className="divide-y divide-stone-800">
        {filtered.map((e) => (
          <div key={e.id} className="flex justify-between px-4 py-3 text-sm">
            <span>{e.action} · {e.table_name}</span>
            <span className="text-xs text-stone-600">
              {new Date(e.occurred_at).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
          )}
        </>
      )}
    </ReportSection>
  );
}

function ReportSection({
  title,
  children,
  onExport,
  loading,
  error,
  empty,
  emptyMessage,
}: {
  title: string;
  children: React.ReactNode;
  onExport?: () => void;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
}) {
  const errMsg = error instanceof Error ? error.message : error ? String(error) : "";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">{title}</h2>
        {onExport && (
          <Button variant="secondary" size="sm" onClick={onExport}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </div>
      {loading && (
        <Card className="px-4 py-8 text-center text-sm text-stone-500">Loading report…</Card>
      )}
      {error && (
        <Card className="border-red-900/40 px-4 py-6 text-sm text-red-300">
          <p className="font-medium">Report failed to load</p>
          <p className="mt-1 text-xs text-red-400/80">{errMsg}</p>
          {errMsg.includes("vessel_lifetime_spend") && (
            <p className="mt-2 text-xs text-stone-400">
              Run migration{" "}
              <span className="font-mono">20260521000008_analytics_views.sql</span> in Supabase
              SQL Editor.
            </p>
          )}
        </Card>
      )}
      {!loading && !error && empty && (
        <Card className="px-4 py-8 text-center text-sm text-stone-500">
          {emptyMessage ?? "No data for this report yet."}
        </Card>
      )}
      {!loading && !error && !empty && <Card className="overflow-hidden">{children}</Card>}
    </section>
  );
}
