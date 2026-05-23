import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ScanLine, Search } from "lucide-react";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { UsageSkuRow } from "@/components/onboard/UsageSkuRow";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLogSkuUsage, useUsageLogSession } from "@/hooks/useOnboard";
import { ensureUsageLogSession } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import {
  aggregateRecentLogs,
  filterSkuRows,
  mapInventoryRpcRows,
  onboardUsageStats,
  type UsageLogEntry,
} from "@/lib/onboardUsage";

export const Route = createFileRoute("/_authed/onboard/log/$cspoId")({
  loader: ({ context: { queryClient }, params: { cspoId } }) =>
    ensureUsageLogSession(queryClient, cspoId),
  component: DailyLogPage,
});

function DailyLogPage() {
  const { cspoId } = Route.useParams();
  const { data: session, isPending } = useUsageLogSession(cspoId);
  const loading = isInitialQueryLoad(isPending, session);
  const logSkuUsage = useLogSkuUsage();
  const [search, setSearch] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [highlightSku, setHighlightSku] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [loggingSkuId, setLoggingSkuId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const skuRows = useMemo(
    () => mapInventoryRpcRows(session?.inventory ?? [], "aboard"),
    [session?.inventory],
  );
  const stats = useMemo(() => onboardUsageStats(skuRows), [skuRows]);
  const filteredRows = useMemo(
    () => filterSkuRows(skuRows, search || scanValue),
    [skuRows, search, scanValue],
  );
  const recentLogs = useMemo(
    () => aggregateRecentLogs((session?.usage_logs ?? []) as unknown as UsageLogEntry[]),
    [session?.usage_logs],
  );

  const handleLog = useCallback(
    async (
      skuId: string,
      actionType: "consumed" | "installed" | "damaged",
      qty: number,
    ) => {
      setLoggingSkuId(skuId);
      setSuccessMsg(null);
      try {
        const res = await logSkuUsage.mutateAsync({
          cspoId,
          skuId,
          actionType,
          qty,
          notes: notes.trim() || undefined,
          location: location.trim() || undefined,
        });
        const row = skuRows.find((r) => r.sku_id === skuId);
        if (res.queued) {
          setSuccessMsg(
            `Saved offline — ${res.result.logged}× ${statusLabel(actionType)}` +
              ` (${row?.name ?? "item"}). Will sync when back online.`,
          );
        } else {
          setSuccessMsg(
            `Logged ${res.result.logged}× ${statusLabel(actionType)} — ${row?.name ?? "item"}` +
              (res.result.remaining_on_vessel > 0
                ? ` (${res.result.remaining_on_vessel} still aboard)`
                : ""),
          );
        }
      } finally {
        setLoggingSkuId(null);
      }
    },
    [cspoId, logSkuUsage, location, notes, skuRows],
  );

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const code = scanValue.trim().toUpperCase();
    if (!code) return;

    const match =
      skuRows.find((row) => row.sku_code.toUpperCase() === code) ??
      skuRows.find((row) => row.sku_code.toUpperCase().startsWith(code));

    if (!match) {
      setScanValue("");
      scanRef.current?.focus();
      return;
    }

    void handleLog(match.sku_id, "consumed", 1);
    setScanValue("");
    scanRef.current?.focus();
  }

  const vessel = session?.cspo.vessel as {
    name: string;
    fleet: { name: string } | null;
  } | null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-16">
      <Link
        to="/onboard"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> Onboard
      </Link>

      <div>
        <h1 className="text-xl font-semibold">Daily usage log</h1>
        {session?.cspo && (
          <p className="font-mono text-sm text-brand-400">{session.cspo.cspo_number}</p>
        )}
        <p className="text-sm text-stone-400">
          {vessel?.name}
          {vessel?.fleet?.name && ` · ${vessel.fleet.name}`}
        </p>
        {!loading && stats.unitCount > 0 && (
          <p className="mt-1 text-sm text-stone-500">
            {stats.skuCount} SKUs · {stats.unitCount} units aboard
          </p>
        )}
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-stone-500">Loading…</div>
      )}

      {!loading && skuRows.length === 0 && (
        <Card className="space-y-3 p-6 text-sm text-stone-400">
          <p className="font-medium text-stone-200">No items currently on vessel for this CSPO.</p>
          <p>Items must be packed (catalog SKUs only) and received aboard first:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Warehouse → pack SKU line items into packages</li>
            <li>Complete packing (sets CSPO to in transit)</li>
            <li>
              <Link to="/onboard/receive/$cspoId" params={{ cspoId }} className="text-brand-400 hover:underline">
                Receive each package aboard
              </Link>
            </li>
          </ol>
        </Card>
      )}

      {skuRows.length > 0 && (
        <>
          <Card className="p-4">
            <form onSubmit={handleScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  ref={scanRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  placeholder="Scan SKU to log 1× used…"
                  className="w-full rounded-md border border-stone-700 bg-stone-900 py-2.5 pl-10 pr-3 text-sm text-stone-100 placeholder:text-stone-600"
                />
              </div>
              <Button type="submit" variant="secondary">
                Scan
              </Button>
            </form>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlightSku(null);
                }}
                placeholder="Search by name or SKU code…"
                className="w-full rounded-md border border-stone-700 bg-stone-900 py-2 pl-10 pr-3 text-sm text-stone-100 placeholder:text-stone-600"
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Location on vessel (optional)"
                className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600"
              />
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes for next entry (optional)"
                className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600"
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
              {search && ` matching “${search}”`}
            </div>
            <div className="max-h-[min(55vh,480px)] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-stone-950">
                  <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Aboard</th>
                    <th className="px-3 py-2 text-right font-medium">UOM</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-stone-500">
                        No SKUs match your search.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <UsageSkuRow
                        key={row.sku_id}
                        row={row}
                        isLogging={logSkuUsage.isPending}
                        loggingSkuId={loggingSkuId}
                        highlighted={highlightSku === row.sku_code}
                        onLog={(skuId, action, qty) => void handleLog(skuId, action, qty)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {logSkuUsage.error && (
        <p className="text-sm text-red-400">{(logSkuUsage.error as Error).message}</p>
      )}

      {recentLogs.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
            Recent entries
          </h2>
          <Card className="divide-y divide-stone-800">
            {recentLogs.slice(0, 20).map((log) => (
              <div key={log.key} className="px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-stone-200">
                      {log.qty > 1 && (
                        <span className="mr-1.5 font-mono text-brand-400">{log.qty}×</span>
                      )}
                      {log.name}
                    </p>
                    <p className="font-mono text-xs text-stone-500">{log.sku_code}</p>
                    {(log.location_on_vessel || log.notes) && (
                      <p className="mt-0.5 text-xs text-stone-600">
                        {[log.location_on_vessel, log.notes].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant="draft">{statusLabel(log.action_type)}</Badge>
                    <p className="mt-1 text-xs text-stone-600">
                      {new Date(log.logged_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
