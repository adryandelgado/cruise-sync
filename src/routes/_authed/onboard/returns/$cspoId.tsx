import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRightLeft, Loader2, ScanLine, Search, Truck } from "lucide-react";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { ReturnSkuRow } from "@/components/onboard/ReturnSkuRow";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useAcknowledgeTransfer,
  useAddReturnSkuQty,
  useCreateReturnManifest,
  useInitiateTransferSkuQty,
  useReturnsSession,
  useSealReturnManifest,
} from "@/hooks/useOnboard";
import {
  filterSkuRows,
  groupManifestBySku,
  mapInventoryRpcRows,
  onboardUsageStats,
} from "@/lib/onboardUsage";
import { ensureReturnsSession } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/onboard/returns/$cspoId")({
  loader: ({ context: { queryClient }, params: { cspoId } }) =>
    ensureReturnsSession(queryClient, cspoId),
  component: ReturnsPage,
});

function ReturnsPage() {
  const { cspoId } = Route.useParams();
  const { data: session, isPending } = useReturnsSession(cspoId);
  const loading = isInitialQueryLoad(isPending, session);
  const inventory = session?.inventory;
  const manifest = session?.manifest;
  const openCspos = session?.open_cspos;
  const pendingTransfers = session?.pending_transfers;

  const createManifest = useCreateReturnManifest();
  const addReturnSku = useAddReturnSkuQty();
  const sealManifest = useSealReturnManifest();
  const transferSku = useInitiateTransferSkuQty();
  const acknowledgeTransfer = useAcknowledgeTransfer();

  const [mode, setMode] = useState<"return" | "transfer">("return");
  const [targetCspo, setTargetCspo] = useState("");
  const [freight, setFreight] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [search, setSearch] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [busySkuId, setBusySkuId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const manifestItems = (manifest?.items ?? []) as unknown as Array<{
    id: string;
    condition: string;
    material_instance: {
      sku: { sku_code: string; name: string } | null;
    } | null;
  }>;

  const skuRows = useMemo(
    () => mapInventoryRpcRows(inventory ?? [], "returns"),
    [inventory],
  );
  const stats = useMemo(() => onboardUsageStats(skuRows), [skuRows]);
  const filteredRows = useMemo(
    () => filterSkuRows(skuRows, search || scanValue),
    [skuRows, search, scanValue],
  );
  const manifestSummary = useMemo(() => groupManifestBySku(manifestItems), [manifestItems]);

  const ensureManifest = useCallback(async () => {
    if (manifest?.id) return manifest.id;
    const { manifestId } = await createManifest.mutateAsync(cspoId);
    return manifestId;
  }, [manifest?.id, createManifest, cspoId]);

  const handleReturn = useCallback(
    async (skuId: string, qty: number) => {
      setBusySkuId(skuId);
      setSuccessMsg(null);
      try {
        const manifestId = await ensureManifest();
        const res = await addReturnSku.mutateAsync({
          manifestId,
          cspoId,
          skuId,
          qty,
        });
        const row = skuRows.find((r) => r.sku_id === skuId);
        if (res.queued) {
          setSuccessMsg(
            `Saved offline — ${res.result.added}× ${row?.name ?? "item"} queued for return manifest`,
          );
        } else {
          setSuccessMsg(`Added ${res.result.added}× ${row?.name ?? "item"} to return manifest`);
        }
      } finally {
        setBusySkuId(null);
      }
    },
    [addReturnSku, cspoId, ensureManifest, skuRows],
  );

  const handleTransfer = useCallback(
    async (skuId: string, qty: number) => {
      if (!targetCspo) return;
      setBusySkuId(skuId);
      setSuccessMsg(null);
      try {
        const res = await transferSku.mutateAsync({
          cspoId,
          skuId,
          toCspoId: targetCspo,
          qty,
          notes: transferNotes.trim() || undefined,
        });
        const row = skuRows.find((r) => r.sku_id === skuId);
        if (res.queued) {
          setSuccessMsg(
            `Saved offline — ${res.result.transferred}× ${row?.name ?? "item"} queued for transfer`,
          );
        } else {
          setSuccessMsg(
            `Transferred ${res.result.transferred}× ${row?.name ?? "item"}` +
              (res.result.remaining_on_vessel > 0
                ? ` (${res.result.remaining_on_vessel} still aboard)`
                : ""),
          );
        }
      } finally {
        setBusySkuId(null);
      }
    },
    [cspoId, skuRows, targetCspo, transferNotes, transferSku],
  );

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const code = scanValue.trim().toUpperCase();
    if (!code) return;

    const match =
      skuRows.find((row) => row.sku_code.toUpperCase() === code) ??
      skuRows.find((row) => row.sku_code.toUpperCase().startsWith(code));

    if (!match || match.on_vessel <= 0) {
      setScanError(`No available units for SKU "${code}".`);
      setScanValue("");
      return;
    }

    if (mode === "transfer" && !targetCspo) {
      setScanError("Select a destination CSPO before scanning transfers.");
      setScanValue("");
      return;
    }

    setScanError(null);
    setScanValue("");

    if (mode === "return") {
      void handleReturn(match.sku_id, match.on_vessel).then(() => {
        scanRef.current?.focus();
      });
    } else {
      void handleTransfer(match.sku_id, match.on_vessel).then(() => {
        scanRef.current?.focus();
      });
    }
  }

  async function handleSeal(e: FormEvent) {
    e.preventDefault();
    if (!manifest?.id) return;
    setSuccessMsg(null);
    const res = await sealManifest.mutateAsync({
      manifestId: manifest.id,
      cspoId,
      freight: freight.trim() || undefined,
    });
    if (res.queued) {
      setSuccessMsg(
        `Saved offline — return manifest (${manifestItems.length} units) queued for seal`,
      );
    } else {
      setSuccessMsg("Return manifest sealed for pickup");
    }
  }

  const pendingBySku = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; value: number; currency: string }>();
    for (const t of pendingTransfers ?? []) {
      const sku = (t.material_instance as unknown as { sku: { sku_code: string; name: string } | null } | null)?.sku;
      const code = sku?.sku_code ?? "?";
      const existing = map.get(code);
      const val = Number(t.transferred_value);
      if (existing) {
        existing.qty += 1;
        existing.value += val;
      } else {
        map.set(code, {
          name: sku?.name ?? "Item",
          qty: 1,
          value: val,
          currency: t.currency,
        });
      }
    }
    return [...map.values()];
  }, [pendingTransfers]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-16">
      <Link
        to="/onboard"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> Onboard
      </Link>

      {loading && (
        <div className="py-12 text-center text-sm text-stone-500">Loading…</div>
      )}

      {!loading && (
        <>
      <div>
        <h1 className="text-xl font-semibold">Returns & transfers</h1>
        <p className="text-sm text-stone-400">
          Send items back to warehouse or migrate value to another CSPO.
        </p>
        {stats.unitCount > 0 && (
          <p className="mt-1 text-sm text-stone-500">
            {stats.skuCount} SKUs · {stats.unitCount} units available
          </p>
        )}
      </div>

      {pendingBySku.length > 0 && (
        <Card className="border-violet-900/40 p-4">
          <h2 className="mb-3 text-sm font-medium text-violet-300">
            Incoming transfers to acknowledge
          </h2>
          <div className="flex flex-col gap-2">
            {pendingBySku.map((row) => (
              <div
                key={row.name}
                className="flex items-center justify-between rounded-md border border-stone-800 p-3 text-sm"
              >
                <div>
                  <p className="text-stone-200">
                    {row.qty > 1 && (
                      <span className="mr-1.5 font-mono text-brand-400">{row.qty}×</span>
                    )}
                    {row.name}
                  </p>
                  <p className="text-xs text-stone-500">
                    {formatCurrency(row.value, row.currency)}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={acknowledgeTransfer.isPending}
                  onClick={() => {
                    const toAck = (pendingTransfers ?? []).filter((t) => {
                      const sku = (
                        t.material_instance as unknown as {
                          sku: { sku_code: string; name: string } | null;
                        } | null
                      )?.sku;
                      return sku?.name === row.name;
                    });
                    setSuccessMsg(null);
                    void Promise.all(
                      toAck.map((t) => acknowledgeTransfer.mutateAsync(t.id)),
                    ).then((results) => {
                      if (results.some((res) => res.queued)) {
                        setSuccessMsg(
                          `Saved offline — ${results.length} transfer(s) queued for acknowledgement`,
                        );
                      }
                    });
                  }}
                >
                  Acknowledge{row.qty > 1 ? ` ${row.qty}` : ""}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <Button
          variant={mode === "return" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setMode("return")}
        >
          <Truck className="h-3.5 w-3.5" /> Return to warehouse
        </Button>
        <Button
          variant={mode === "transfer" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setMode("transfer")}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer to CSPO
        </Button>
      </div>

      {mode === "transfer" && (
        <Card className="p-4">
          <label className="mb-1.5 block text-xs text-stone-400">Target CSPO</label>
          <select
            value={targetCspo}
            onChange={(e) => setTargetCspo(e.target.value)}
            className={inputClass}
          >
            <option value="">Select destination CSPO…</option>
            {(openCspos ?? [])
              .filter((c) => c.id !== cspoId)
              .map((c) => {
                const v = c.vessel as unknown as { name: string } | null;
                return (
                  <option key={c.id} value={c.id}>
                    {c.cspo_number} — {v?.name ?? "?"}
                  </option>
                );
              })}
          </select>
          <input
            placeholder="Transfer notes (optional)"
            value={transferNotes}
            onChange={(e) => setTransferNotes(e.target.value)}
            className={`${inputClass} mt-2`}
          />
        </Card>
      )}

      {skuRows.length > 0 ? (
        <>
          <Card className="p-4">
            <form onSubmit={handleScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  ref={scanRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  placeholder={
                    mode === "return"
                      ? "Scan SKU to add all available to manifest…"
                      : "Scan SKU to transfer all available units…"
                  }
                  className={`${inputClass} pl-10`}
                />
              </div>
              <Button type="submit" variant="secondary">
                Scan
              </Button>
            </form>
            {scanError && <p className="mt-2 text-xs text-amber-400">{scanError}</p>}
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or SKU…"
                className={`${inputClass} pl-10`}
              />
            </div>
          </Card>

          {successMsg && (
            <div className="rounded-md border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
              {successMsg}
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="border-b border-stone-800 px-3 py-2 text-xs text-stone-500">
              {filteredRows.length} of {skuRows.length} SKUs
            </div>
            <div className="max-h-[min(50vh,440px)] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-stone-950">
                  <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Aboard</th>
                    {mode === "return" && (
                      <th className="px-3 py-2 text-right font-medium">On manifest</th>
                    )}
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={mode === "return" ? 5 : 4}
                        className="px-3 py-8 text-center text-stone-500"
                      >
                        No SKUs match your search.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <ReturnSkuRow
                        key={row.sku_id}
                        row={row}
                        mode={mode}
                        onManifest={row.on_manifest ?? 0}
                        disabled={
                          mode === "return"
                            ? addReturnSku.isPending || createManifest.isPending
                            : transferSku.isPending
                        }
                        busy={busySkuId === row.sku_id}
                        canTransfer={!!targetCspo}
                        onAction={(skuId, qty) =>
                          void (mode === "return"
                            ? handleReturn(skuId, qty)
                            : handleTransfer(skuId, qty))
                        }
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card className="p-6 text-sm text-stone-400">
          <p className="font-medium text-stone-200">No items aboard to return or transfer.</p>
          <p className="mt-2">
            Receive packed catalog items first at{" "}
            <Link to="/onboard/receive/$cspoId" params={{ cspoId }} className="text-brand-400 hover:underline">
              Receive aboard
            </Link>
            .
          </p>
        </Card>
      )}

      {mode === "return" && manifestSummary.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-stone-200">
            Return manifest ({manifestItems.length} units · {manifestSummary.length} SKUs)
          </h2>
          <ul className="mb-4 space-y-1 text-sm text-stone-400">
            {manifestSummary.map((row) => (
              <li key={`${row.sku_code}-${row.condition}`}>
                {row.qty > 1 && (
                  <span className="mr-1 font-mono text-brand-400">{row.qty}×</span>
                )}
                {row.name}{" "}
                <span className="text-stone-600">· {row.condition}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => void handleSeal(e)} className="flex flex-col gap-3">
            <input
              placeholder="Freight company (optional)"
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              className={inputClass}
            />
            <Button type="submit" disabled={sealManifest.isPending}>
              {sealManifest.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Seal manifest for pickup"
              )}
            </Button>
          </form>
          {sealManifest.error && (
            <p className="mt-2 text-xs text-red-400">
              {(sealManifest.error as Error).message}
            </p>
          )}
        </Card>
      )}

      {(transferSku.error || addReturnSku.error || createManifest.error) && (
        <p className="text-sm text-red-400">
          {(
            (transferSku.error ?? addReturnSku.error ?? createManifest.error) as Error
          ).message}
        </p>
      )}
        </>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
