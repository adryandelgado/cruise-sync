import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Loader2,
  PackagePlus,
  ScanLine,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  computePackStats,
  PackLineRow,
  packageUnitCount,
} from "@/components/warehouse/PackLineRow";
import { Card } from "@/components/ui/card";
import {
  useCompletePacking,
  useCreatePackage,
  usePackItem,
  usePackSession,
  useUpdatePackageSpecs,
} from "@/hooks/usePackJobs";
import { useCreateProcurementRequest } from "@/hooks/useProcurement";
import { cn } from "@/lib/utils";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ensurePackSession, prefetchPackingDocs } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";

export const Route = createFileRoute("/_authed/warehouse/pack/$cspoId")({
  loader: ({ context: { queryClient }, params: { cspoId } }) =>
    ensurePackSession(queryClient, cspoId),
  component: PackModePage,
});

const PACKAGE_TYPES = [
  "pallet",
  "crate",
  "box",
  "toolbox",
  "container",
  "platform",
] as const;

function PackModePage() {
  const { cspoId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: session, isPending, error } = usePackSession(cspoId);
  const createPackage = useCreatePackage();
  const packItem = usePackItem();
  const updateSpecs = useUpdatePackageSpecs();
  const completePacking = useCompletePacking();
  const createProcurement = useCreateProcurementRequest();
  const [procurementMsg, setProcurementMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [packMsg, setPackMsg] = useState<string | null>(null);
  const [completeMsg, setCompleteMsg] = useState<string | null>(null);

  const [activePackageId, setActivePackageId] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [newPackageType, setNewPackageType] = useState<string>("pallet");
  const [lineFilter, setLineFilter] = useState<"pending" | "done" | "all">("pending");
  const [search, setSearch] = useState("");
  const [packingLineId, setPackingLineId] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const listItems = session?.list.items ?? [];
  const packages = session?.packages ?? [];
  const stockBySku = session?.stockBySku ?? {};

  const stats = useMemo(() => computePackStats(listItems), [listItems]);

  const activePackage = useMemo(
    () =>
      packages.find((p) => p.id === activePackageId) ??
      packages.find((p) => p.status === "open") ??
      null,
    [packages, activePackageId],
  );

  const activePackageUnits = useMemo(
    () => (activePackage ? packageUnitCount(activePackage.contents) : 0),
    [activePackage],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toUpperCase();
    return listItems.filter((item) => {
      const remaining = Number(item.requested_qty) - Number(item.packed_qty);
      const done = remaining <= 0;
      if (lineFilter === "pending" && done) return false;
      if (lineFilter === "done" && !done) return false;
      if (!q) return true;
      const code = item.sku?.sku_code?.toUpperCase() ?? "";
      const name =
        item.sku?.name?.toUpperCase() ?? item.custom_description?.toUpperCase() ?? "";
      return code.includes(q) || name.includes(q);
    });
  }, [listItems, lineFilter, search]);

  const allPacked = stats.remainingUnits === 0 && stats.totalUnits > 0;

  const handlePack = useCallback(
    async (listItemId: string, isCustom: boolean, qty: number, label?: string) => {
      if (!activePackage) return;
      setPackingLineId(listItemId);
      setPackMsg(null);
      try {
        const result = await packItem.mutateAsync({
          listItemId,
          packageId: activePackage.id,
          cspoId,
          isCustom,
          qty,
        });
        if (result.queued) {
          setPackMsg(
            `Saved offline — ${result.packedDelta}× ${label ?? "item"} queued for pack sync`,
          );
        }
        setScanValue("");
        scanRef.current?.focus();
      } finally {
        setPackingLineId(null);
      }
    },
    [activePackage, cspoId, packItem],
  );

  if (isInitialQueryLoad(isPending, session)) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading…</div>;
  }

  if (error || !session) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-red-400">{(error as Error)?.message ?? "Not found"}</p>
        <Link to="/warehouse" className="mt-3 inline-block text-xs text-stone-500 underline">
          Back to jobs
        </Link>
      </div>
    );
  }

  const { cspo, list } = session;

  async function handleCreatePackage() {
    setPackMsg(null);
    const pkg = await createPackage.mutateAsync({
      cspoId,
      packageType: newPackageType,
    });
    if (pkg.queued) {
      setPackMsg(
        `Saved offline — ${pkg.package_type} #${pkg.package_number} queued for sync`,
      );
    }
    setActivePackageId(pkg.id);
  }

  function findPackLineByScan(
    items: typeof listItems,
    code: string,
  ) {
    const pending = items.filter(
      (item) =>
        item.sku &&
        Number(item.packed_qty) < Number(item.requested_qty),
    );
    return (
      pending.find((item) => item.sku!.sku_code.toUpperCase() === code) ??
      pending.find((item) => item.sku!.sku_code.toUpperCase().startsWith(code))
    );
  }

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const code = scanValue.trim().toUpperCase();
    if (!code) return;

    if (!activePackage) {
      setScanError("Create or select an open package before scanning.");
      return;
    }

    const match = findPackLineByScan(list.items, code);
    if (!match) {
      setScanError(`No pending line for SKU "${code}".`);
      setScanValue("");
      return;
    }

    setScanError(null);
    const remaining = Number(match.requested_qty) - Number(match.packed_qty);
    void handlePack(match.id, !match.sku_id, remaining, match.sku?.name ?? match.custom_description ?? code);
    setScanValue("");
  }

  async function handleComplete(e: FormEvent) {
    e.preventDefault();
    setCompleteMsg(null);
    const result = await completePacking.mutateAsync(cspoId);
    if (result.queued) {
      setCompleteMsg("Saved offline — packing completion queued for sync");
    }
    void navigate({
      to: "/warehouse/docs/$cspoId",
      params: { cspoId },
      search: { invoice: result.invoice_number },
    });
  }

  if (cspo.status === "in_transit" || cspo.status === "on_vessel") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Check className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
        <h1 className="text-xl font-semibold">Packing complete</h1>
        <p className="mt-2 text-sm text-stone-400">
          {cspo.cspo_number} is ready for freight pickup.
        </p>
        <Link
          to="/warehouse/docs/$cspoId"
          params={{ cspoId }}
          search={{ invoice: undefined }}
          className="mt-6 inline-block"
          onMouseEnter={() => prefetchPackingDocs(qc, cspoId)}
        >
          <Button>View documents</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-24">
      <Link
        to="/warehouse"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> My jobs
      </Link>

      {/* Header */}
      <div>
        <h1 className="font-mono text-xl font-semibold">{cspo.cspo_number}</h1>
        <p className="text-sm text-stone-400">
          {cspo.vessel?.name}
          {cspo.vessel?.fleet?.name && ` · ${cspo.vessel.fleet.name}`}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          {stats.packedUnits} / {stats.totalUnits} units packed ·{" "}
          {stats.completeLines} / {stats.totalLines} lines complete
          {list.status === "awaiting_procurement" && (
            <span className="ml-2 text-amber-400">· awaiting procurement</span>
          )}
          {list.status === "in_packing" && list.items.some((i) => i.status === "procuring") && (
            <span className="ml-2 text-emerald-400">· stock received — continue packing</span>
          )}
        </p>
      </div>

      {packMsg && (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          {packMsg}
        </div>
      )}

      {procurementMsg && (
        <div
          className={cn(
            "rounded-md border px-4 py-3 text-sm",
            procurementMsg.type === "ok"
              ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-200"
              : "border-red-900/60 bg-red-950/40 text-red-300",
          )}
        >
          {procurementMsg.text}
        </div>
      )}

      {createProcurement.error && !procurementMsg && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {(createProcurement.error as Error).message}
        </div>
      )}

      {/* Current package */}
      <Card className="border-brand-800/40 bg-brand-950/20 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">
            Current package
          </h2>
          <Button
            variant="secondary"
            size="sm"
            disabled={createPackage.isPending}
            onClick={() => void handleCreatePackage()}
          >
            {createPackage.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PackagePlus className="h-3.5 w-3.5" />
            )}
            Add package
          </Button>
        </div>

        {!activePackage ? (
          <div className="flex flex-col gap-3 py-4 text-center">
            <p className="text-sm text-stone-400">No package selected</p>
            <div className="flex items-center justify-center gap-2">
              <select
                value={newPackageType}
                onChange={(e) => setNewPackageType(e.target.value)}
                className={inputClass}
              >
                {PACKAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {statusLabel(t)}
                  </option>
                ))}
              </select>
              <Button onClick={() => void handleCreatePackage()}>
                Create {statusLabel(newPackageType)} #1
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-lg font-medium capitalize text-stone-100">
                {statusLabel(activePackage.package_type)} #{activePackage.package_number}
              </span>
              <Badge variant="packing">{activePackageUnits} units</Badge>
            </div>

            {packages.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {packages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActivePackageId(p.id)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs capitalize",
                      p.id === activePackage.id
                        ? "border-brand-600 bg-brand-950/40 text-stone-100"
                        : "border-stone-700 text-stone-400 hover:border-stone-600",
                    )}
                  >
                    {statusLabel(p.package_type)} #{p.package_number}
                    <span className="ml-1 text-stone-500">
                      ({packageUnitCount(p.contents)})
                    </span>
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  ref={scanRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  placeholder="Scan barcode or enter SKU code…"
                  className={cn(inputClass, "pl-10")}
                  autoFocus
                />
              </div>
              <Button type="submit" variant="secondary">
                Scan
              </Button>
            </form>
            {scanError && (
              <p className="mt-2 text-xs text-amber-400">{scanError}</p>
            )}
          </>
        )}
      </Card>

      {/* Line items — compact table for large orders */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-800 px-3 py-2">
          {(["pending", "done", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setLineFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs capitalize",
                lineFilter === f
                  ? "bg-stone-800 text-stone-100"
                  : "text-stone-500 hover:text-stone-300",
              )}
            >
              {f === "pending"
                ? `Pending (${stats.totalLines - stats.completeLines})`
                : f === "done"
                  ? `Done (${stats.completeLines})`
                  : `All (${stats.totalLines})`}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter SKU…"
            className="ml-auto w-40 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100"
          />
        </div>
        <div className="max-h-[min(60vh,520px)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-stone-950">
              <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Need</th>
                <th className="px-3 py-2 text-right font-medium">Packed</th>
                <th className="px-3 py-2 text-right font-medium">Left</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Pack</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-stone-500">
                    {lineFilter === "pending" && stats.remainingUnits === 0
                      ? "All units packed — finish packing below."
                      : "No lines match filter."}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <PackLineRow
                    key={item.id}
                    item={item}
                    activePackageId={activePackage?.id ?? null}
                    stockBySku={stockBySku}
                    isPacking={packItem.isPending}
                    packingLineId={packingLineId}
                    onPack={(id, isCustom, qty) => {
                      const line = list.items.find((row) => row.id === id);
                      const label = line?.sku?.name ?? line?.custom_description ?? "item";
                      void handlePack(id, isCustom, qty, label);
                    }}
                    onRequestProcurement={(row, remaining, sub) => {
                      if (!row.sku_id) return;
                      setProcurementMsg(null);
                      void createProcurement
                        .mutateAsync({
                          skuId: row.sku_id,
                          qtyNeeded: remaining,
                          cspoId,
                          listItemId: row.id,
                          notes: `Stock-out during pack of ${cspo.cspo_number}`,
                        })
                        .then(() => {
                          setProcurementMsg({
                            type: "ok",
                            text: `Procurement requested for ${remaining}× ${sub}.`,
                          });
                        })
                        .catch((e: Error) => {
                          setProcurementMsg({ type: "err", text: e.message });
                        });
                    }}
                    isProcuring={createProcurement.isPending}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Complete flow */}
      {allPacked && packages.length > 0 && (
        <Card className="border-emerald-900/40 p-4">
          {!showComplete ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-emerald-300">All items packed</p>
                <p className="text-xs text-stone-500">
                  Enter package dimensions, then generate docs.
                </p>
              </div>
              <Button
                onClick={() => setShowComplete(true)}
                onMouseEnter={() => prefetchPackingDocs(qc, cspoId)}
              >
                Finish packing
              </Button>
            </div>
          ) : (
            <form onSubmit={(e) => void handleComplete(e)} className="flex flex-col gap-4">
              <p className="text-sm font-medium text-stone-200">Package dimensions</p>
              {packages.map((pkg) => (
                <PackageSpecsRow
                  key={pkg.id}
                  pkg={pkg}
                  cspoId={cspoId}
                  onSave={(specs) =>
                    void updateSpecs.mutateAsync({ packageId: pkg.id, cspoId, ...specs })
                  }
                />
              ))}
              {completePacking.error && (
                <p className="text-xs text-red-400">
                  {(completePacking.error as Error).message}
                </p>
              )}
              {completeMsg && (
                <p className="text-xs text-amber-300">{completeMsg}</p>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={completePacking.isPending}
                onMouseEnter={() => prefetchPackingDocs(qc, cspoId)}
              >
                {completePacking.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Generate COI & packing list"
                )}
              </Button>
            </form>
          )}
        </Card>
      )}

      {(packItem.error || createPackage.error) && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-red-900/60 bg-red-950/90 px-4 py-2 text-sm text-red-300">
          {((packItem.error ?? createPackage.error) as Error).message}
        </div>
      )}
    </div>
  );
}

function PackageSpecsRow({
  pkg,
  onSave,
}: {
  pkg: {
    id: string;
    package_type: string;
    package_number: number;
    length: number | null;
    width: number | null;
    height: number | null;
    weight: number | null;
  };
  cspoId: string;
  onSave: (specs: {
    length?: number;
    width?: number;
    height?: number;
    weight?: number;
  }) => void;
}) {
  const [length, setLength] = useState(pkg.length?.toString() ?? "");
  const [width, setWidth] = useState(pkg.width?.toString() ?? "");
  const [height, setHeight] = useState(pkg.height?.toString() ?? "");
  const [weight, setWeight] = useState(pkg.weight?.toString() ?? "");

  function save() {
    onSave({
      length: parseFloat(length) || undefined,
      width: parseFloat(width) || undefined,
      height: parseFloat(height) || undefined,
      weight: parseFloat(weight) || undefined,
    });
  }

  return (
    <div className="rounded-md border border-stone-800 p-3">
      <p className="mb-2 text-xs capitalize text-stone-400">
        {statusLabel(pkg.package_type)} #{pkg.package_number}
      </p>
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ["L (in)", length, setLength],
            ["W (in)", width, setWidth],
            ["H (in)", height, setHeight],
            ["Wt (lb)", weight, setWeight],
          ] as const
        ).map(([label, val, setter]) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="text-xs text-stone-600">{label}</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={val}
              onChange={(e) => setter(e.target.value)}
              onBlur={save}
              className={inputClass}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
