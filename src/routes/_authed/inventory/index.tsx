import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus, Search, Upload } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCreateSku, useImportSkusCsv, useMaterialInstances, useReceiveStock } from "@/hooks/useInventory";
import { useMaterialTrace } from "@/hooks/useReports";
import { useInventoryCatalogHub } from "@/hooks/useSkus";
import {
  catalogCategories,
  filterCatalogStock,
} from "@/lib/catalogStats";
import {
  filterInstances,
  groupInstancesBySku,
  type InstanceRow,
} from "@/lib/inventoryStats";
import { cn, formatCurrency } from "@/lib/utils";
import { ensureInventoryHub, prefetchMaterialInstances, ensureMaterialInstances, prefetchMaterialTrace } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";

export const Route = createFileRoute("/_authed/inventory/")({
  loader: ({ context: { queryClient } }) => ensureInventoryHub(queryClient),
  component: InventoryPage,
});

type Tab = "catalog" | "instances" | "import";

function InventoryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("catalog");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-stone-400">
            SKU catalog, material instance ledger, CSV import.
          </p>
        </div>
      </header>

      <div className="flex gap-2 border-b border-stone-800 pb-2">
        {(["catalog", "instances", "import"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              if (t === "instances") void ensureMaterialInstances(qc);
            }}
            onMouseEnter={() => {
              if (t === "instances") prefetchMaterialInstances(qc);
            }}
            onFocus={() => {
              if (t === "instances") prefetchMaterialInstances(qc);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm capitalize",
              tab === t
                ? "bg-stone-800 text-stone-100"
                : "text-stone-500 hover:text-stone-300",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "catalog" && <CatalogTab />}
      {tab === "instances" && (
        <InstancesTab
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          selectedInstance={selectedInstance}
          onSelectInstance={setSelectedInstance}
        />
      )}
      {tab === "import" && <ImportTab />}
    </div>
  );
}

function CatalogTab() {
  const { data: hub, isPending } = useInventoryCatalogHub();
  const loading = isInitialQueryLoad(isPending, hub);
  const stock = hub?.stock ?? [];
  const summary = hub?.summary;
  const createSku = useCreateSku();
  const receiveStock = useReceiveStock();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [receiveSku, setReceiveSku] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState("1");
  const [form, setForm] = useState({
    sku_code: "",
    name: "",
    category: "",
    default_cost: "",
  });

  const categories = useMemo(() => catalogCategories(stock ?? []), [stock]);
  const filtered = useMemo(
    () => filterCatalogStock(stock ?? [], search, category, lowStockOnly),
    [stock, search, category, lowStockOnly],
  );

  async function handleAddSku(e: FormEvent) {
    e.preventDefault();
    await createSku.mutateAsync({
      sku_code: form.sku_code,
      name: form.name,
      category: form.category,
      default_cost: parseFloat(form.default_cost) || undefined,
    });
    setShowAdd(false);
    setForm({ sku_code: "", name: "", category: "", default_cost: "" });
  }

  return (
    <>
      {summary && summary.skuCount > 0 && (
        <p className="text-xs text-stone-500">
          {summary.skuCount} SKUs · {summary.totalOnHand} units in warehouse
          {summary.lowStockCount > 0 && (
            <span className="ml-2 text-amber-400">
              · {summary.lowStockCount} below reorder threshold
            </span>
          )}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
          <input
            type="search"
            placeholder="Search SKU code, name, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> Add SKU
        </Button>
      </div>

      {!loading && (stock?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-300"
          >
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setLowStockOnly((v) => !v)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              lowStockOnly ? "bg-amber-950/40 text-amber-200" : "text-stone-500 hover:text-stone-300",
            )}
          >
            Low stock only
          </button>
          <span className="text-xs text-stone-500">
            {filtered.length} of {stock!.length} SKUs
          </span>
        </div>
      )}

      {showAdd && (
        <Card className="p-4">
          <form onSubmit={(e) => void handleAddSku(e)} className="grid grid-cols-2 gap-3">
            <input required placeholder="SKU code" value={form.sku_code}
              onChange={(e) => setForm((f) => ({ ...f, sku_code: e.target.value }))} className={inputClass} />
            <input required placeholder="Name" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
            <input placeholder="Category" value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputClass} />
            <input type="number" step="0.01" placeholder="Default cost" value={form.default_cost}
              onChange={(e) => setForm((f) => ({ ...f, default_cost: e.target.value }))} className={inputClass} />
            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={createSku.isPending}>Save SKU</Button>
            </div>
          </form>
        </Card>
      )}

      {loading && <div className="py-12 text-center text-sm text-stone-500">Loading…</div>}

      {!loading && (!stock || stock.length === 0) && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm font-medium text-stone-400">No SKUs in catalog</p>
            <p className="max-w-xs text-xs text-stone-600">
              Add SKUs manually or import a CSV on the Import tab.
            </p>
          </div>
        </Card>
      )}

      {!loading && stock && stock.length > 0 && filtered.length === 0 && (
        <Card className="py-12 text-center text-sm text-stone-500">
          No SKUs match your filters
        </Card>
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="max-h-[min(70vh,640px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-stone-950">
              <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">On hand</th>
                <th className="px-4 py-3 font-medium text-right">Allocated</th>
                <th className="px-4 py-3 font-medium text-right">In field</th>
                <th className="px-4 py-3 font-medium text-right">Cost</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {filtered.map((s) => {
                const low = s.reorder_threshold != null && s.on_hand <= s.reorder_threshold;
                return (
                  <tr key={s.sku_id} className="hover:bg-stone-900/40">
                    <td className="px-4 py-3 font-mono text-brand-400">{s.sku_code}</td>
                    <td className="px-4 py-3 text-stone-200">{s.name}</td>
                    <td className="px-4 py-3 text-stone-500">{s.category ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      <span className={cn(low && "text-amber-400")}>
                        {low && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                        {s.on_hand}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-stone-400">{s.allocated}</td>
                    <td className="px-4 py-3 text-right font-mono text-stone-400">{s.in_field}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {s.default_cost != null ? formatCurrency(Number(s.default_cost)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setReceiveSku(s.sku_id)}>
                        + Stock
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      {receiveSku && (
        <Card className="fixed bottom-4 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 p-4 shadow-xl">
          <p className="mb-2 text-sm text-stone-300">Receive stock into warehouse</p>
          <input type="number" min="1" value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} className={inputClass} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReceiveSku(null)}>Cancel</Button>
            <Button size="sm" disabled={receiveStock.isPending}
              onClick={() => void receiveStock.mutateAsync({ skuId: receiveSku, qty: parseInt(receiveQty, 10) || 1 }).then(() => setReceiveSku(null))}>
              Receive
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

function InstancesTab({
  statusFilter,
  onStatusFilter,
  selectedInstance,
  onSelectInstance,
}: {
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  selectedInstance: string | null;
  onSelectInstance: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const { data: instanceData, isPending } = useMaterialInstances(statusFilter || undefined);
  const loading = isInitialQueryLoad(isPending, instanceData);
  const { data: history, isPending: tracePending } = useMaterialTrace(selectedInstance ?? "");
  const traceLoading = selectedInstance
    ? isInitialQueryLoad(tracePending, history)
    : false;
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"detail" | "summary">("summary");

  const statuses = ["in_stock", "on_vessel", "packed", "consumed", "returning", "transferring"];

  const rows = (instanceData?.instances ?? []) as unknown as InstanceRow[];
  const totalCount = instanceData?.totalCount ?? 0;
  const truncated = instanceData?.truncated ?? false;
  const filtered = useMemo(() => filterInstances(rows, search), [rows, search]);
  const grouped = useMemo(() => groupInstancesBySku(filtered), [filtered]);

  useEffect(() => {
    void ensureMaterialInstances(qc, statusFilter || undefined);
  }, [qc, statusFilter]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onStatusFilter("")}
              className={cn("rounded-md px-2 py-1 text-xs", !statusFilter ? "bg-stone-800 text-stone-100" : "text-stone-500")}>
              All
            </button>
            {statuses.map((s) => (
              <button key={s} type="button" onClick={() => onStatusFilter(s)}
                className={cn("rounded-md px-2 py-1 text-xs capitalize", statusFilter === s ? "bg-stone-800 text-stone-100" : "text-stone-500")}>
                {statusLabel(s)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView("summary")}
              className={cn(
                "rounded-md px-2 py-1 text-xs",
                view === "summary" ? "bg-stone-800 text-stone-100" : "text-stone-500",
              )}
            >
              By SKU
            </button>
            <button
              type="button"
              onClick={() => setView("detail")}
              className={cn(
                "rounded-md px-2 py-1 text-xs",
                view === "detail" ? "bg-stone-800 text-stone-100" : "text-stone-500",
              )}
            >
              Instances
            </button>
          </div>
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
          <input
            type="search"
            placeholder="Search SKU, name, or CSPO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none"
          />
        </div>

        {loading && <div className="py-8 text-center text-sm text-stone-500">Loading…</div>}

        {!loading && (
          <p className="mb-2 text-xs text-stone-500">
            {view === "summary"
              ? `${grouped.length} SKUs · ${filtered.length} of ${totalCount} instances shown`
              : `${filtered.length} of ${totalCount} instances shown`}
          </p>
        )}

        {truncated && !loading && (
          <div className="mb-3 rounded-md border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
            Showing the most recent {rows.length} of {totalCount} instances — narrow with status
            filter or search to find specific items.
          </div>
        )}

        <Card className="overflow-hidden">
          {view === "summary" ? (
            <div className="max-h-[min(70vh,640px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-stone-950">
                  <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3">Status(es)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60">
                  {grouped.map((row) => (
                    <tr key={row.sku_code}>
                      <td className="px-4 py-3">
                        <p className="text-stone-200">{row.name}</p>
                        <p className="font-mono text-xs text-stone-500">{row.sku_code}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-brand-300">{row.qty}</td>
                      <td className="px-4 py-3 text-xs capitalize text-stone-400">
                        {row.statuses.map((s) => statusLabel(s)).join(", ")}
                      </td>
                    </tr>
                  ))}
                  {!loading && grouped.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-stone-500">
                        No instances match your filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="max-h-[min(70vh,640px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-stone-950">
                  <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Location / CSPO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60">
                  {filtered.map((inst) => {
                    const sku = inst.sku;
                    const loc = inst.location;
                    const cspo = inst.cspo;
                    return (
                      <tr
                        key={inst.id}
                        className="cursor-pointer hover:bg-stone-900/40"
                        onClick={() => onSelectInstance(inst.id)}
                        onMouseEnter={() => prefetchMaterialTrace(qc, inst.id)}
                      >
                        <td className="px-4 py-3">
                          <p className="text-stone-200">{sku?.name ?? "—"}</p>
                          <p className="font-mono text-xs text-stone-500">{sku?.sku_code}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="draft">{statusLabel(inst.status)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-stone-400">
                          {cspo?.cspo_number ?? loc?.code ?? loc?.name ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-stone-500">
                        No instances match your filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
          Movement history
        </h2>
        {!selectedInstance && <p className="text-sm text-stone-500">Select an instance</p>}
        {traceLoading && (
          <p className="text-sm text-stone-500">Loading movement history…</p>
        )}
        {selectedInstance && !traceLoading && (!history || history.length === 0) && (
          <p className="text-sm text-stone-500">No movements yet</p>
        )}
        <ol className="space-y-2 text-sm">
          {(history ?? []).map((m) => (
            <li key={m.movement_id} className="border-l-2 border-stone-700 pl-3">
              <p className="text-stone-300">
                {m.from_status ? `${statusLabel(m.from_status)} → ` : ""}
                {statusLabel(m.to_status ?? "")}
              </p>
              <p className="text-xs text-stone-600">
                {m.cspo_number && `CSPO ${m.cspo_number} · `}
                {new Date(m.occurred_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function ImportTab() {
  const importCsv = useImportSkusCsv();
  const [csvText, setCsvText] = useState("");

  async function handleImport() {
    const lines = csvText.trim().split("\n").slice(1);
    const rows = lines.map((line) => {
      const [sku_code, name, category, default_cost, unit_of_measure, initial_qty] =
        line.split(",").map((c) => c.trim());
      return {
        sku_code,
        name,
        category,
        default_cost: parseFloat(default_cost) || undefined,
        unit_of_measure: unit_of_measure || "each",
        initial_qty: parseInt(initial_qty ?? "0", 10) || 0,
      };
    }).filter((r) => r.sku_code && r.name);

    await importCsv.mutateAsync(rows);
    setCsvText("");
  }

  function downloadTemplate() {
    const template = "sku_code,name,category,default_cost,unit_of_measure,initial_qty\nPETZL-ASAP-LOCK,Petzl ASAP Lock,fall protection,285,each,4\n";
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shipsync-inventory-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-stone-400">
          Paste CSV or download the template. Columns: sku_code, name, category, default_cost, unit_of_measure, initial_qty
        </p>
        <Button variant="secondary" size="sm" onClick={downloadTemplate}>
          <Download className="h-3.5 w-3.5" /> Template
        </Button>
      </div>
      <textarea
        rows={10}
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder="sku_code,name,category,default_cost,unit_of_measure,initial_qty&#10;..."
        className={cn(inputClass, "font-mono text-xs")}
      />
      <div className="mt-3 flex justify-end">
        <Button disabled={!csvText.trim() || importCsv.isPending} onClick={() => void handleImport()}>
          <Upload className="h-4 w-4" /> Import
        </Button>
      </div>
      {importCsv.isSuccess && (
        <p className="mt-2 text-sm text-emerald-400">Import complete.</p>
      )}
      {importCsv.error && (
        <p className="mt-2 text-sm text-red-400">{(importCsv.error as Error).message}</p>
      )}
    </Card>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
