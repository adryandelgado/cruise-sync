import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, PackageCheck, ScanLine, Search } from "lucide-react";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { JobListToolbar } from "@/components/shared/JobListToolbar";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useCompleteReturnReceipt,
  useReceiveReturnSkuQty,
  useReturnReceiptJobs,
  type ReturnRestockJob,
} from "@/hooks/useClosure";
import { filterSkuRows } from "@/lib/onboardUsage";
import { ensureReturnRestockJobs } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/warehouse/restock/")({
  loader: ({ context: { queryClient } }) => ensureReturnRestockJobs(queryClient),
  component: RestockPage,
});

function filterManifests(
  jobs: ReturnRestockJob[],
  search: string,
): ReturnRestockJob[] {
  const q = search.trim().toUpperCase();
  if (!q) return jobs;
  return jobs.filter(
    (m) =>
      m.cspo_number.toUpperCase().includes(q) ||
      m.vessel_name.toUpperCase().includes(q),
  );
}

function RestockPage() {
  const { data: jobs, isPending, error } = useReturnReceiptJobs();
  const receiveSku = useReceiveReturnSkuQty();
  const completeReceipt = useCompleteReturnReceipt();
  const [manifestSearch, setManifestSearch] = useState("");
  const [searchByManifest, setSearchByManifest] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const filteredManifests = useMemo(
    () => filterManifests(jobs ?? [], manifestSearch),
    [jobs, manifestSearch],
  );

  function findRestockMatch(code: string) {
    for (const manifest of filteredManifests) {
      const row =
        manifest.skus.find(
          (s) => s.pending > 0 && s.sku_code.toUpperCase() === code,
        ) ??
        manifest.skus.find(
          (s) => s.pending > 0 && s.sku_code.toUpperCase().startsWith(code),
        );
      if (row) return { manifest, row };
    }
    return null;
  }

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const code = scanValue.trim().toUpperCase();
    if (!code) return;

    const match = findRestockMatch(code);
    if (!match) {
      setScanError(`No pending restock line for SKU "${code}".`);
      setScanValue("");
      return;
    }

    setScanError(null);
    setSuccessMsg(null);
    const key = `${match.manifest.manifest_id}-${match.row.sku_id}`;
    setBusyKey(key);
    void receiveSku
      .mutateAsync({
        manifestId: match.manifest.manifest_id,
        skuId: match.row.sku_id,
        qty: match.row.pending,
      })
      .then((res) => {
        if (res.queued) {
          setSuccessMsg(
            `Saved offline — ${res.result.received}× ${match.row.name} queued for restock`,
          );
        }
        setScanValue("");
        scanRef.current?.focus();
      })
      .finally(() => setBusyKey(null));
  }

  if (isInitialQueryLoad(isPending, jobs)) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading…</div>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-16">
      <Link to="/warehouse" className="text-sm text-stone-400 hover:text-stone-200">
        ← Warehouse
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Restock</h1>
        <p className="text-sm text-stone-400">
          Scan return shipments back into warehouse inventory — grouped by SKU.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!jobs?.length && (
        <Card className="space-y-2 p-6 text-sm text-stone-400">
          <p className="font-medium text-stone-200">No return shipments awaiting restock.</p>
          <p>After onboard seals a return manifest, items appear here for warehouse scan-in.</p>
        </Card>
      )}

      {!!jobs?.length && (
        <>
          <JobListToolbar
            search={manifestSearch}
            onSearch={setManifestSearch}
            placeholder="Search PO # or vessel…"
            count={filteredManifests.length}
            total={jobs.length}
            countLabel="manifests"
          />

          <Card className="p-4">
            <form onSubmit={handleScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  ref={scanRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  placeholder="Scan SKU to restock all pending units…"
                  className="w-full rounded-md border border-stone-700 bg-stone-900 py-2.5 pl-10 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  autoFocus
                />
              </div>
              <Button type="submit" variant="secondary" disabled={receiveSku.isPending}>
                Scan
              </Button>
            </form>
            {scanError && <p className="mt-2 text-xs text-amber-400">{scanError}</p>}
            {successMsg && (
              <p className="mt-2 text-xs text-emerald-300">{successMsg}</p>
            )}
          </Card>
        </>
      )}

      {jobs?.length && filteredManifests.length === 0 && (
        <Card className="py-12 text-center text-sm text-stone-500">
          No manifests match your search
        </Card>
      )}

      {filteredManifests.map((manifest) => {
        const skuRows = manifest.skus;
        const search = searchByManifest[manifest.manifest_id] ?? "";
        const filtered = filterSkuRows(
          skuRows.map((r) => ({
            sku_id: r.sku_id,
            sku_code: r.sku_code,
            name: r.name,
            unit_of_measure: "ea",
            on_vessel: r.pending,
          })),
          search,
        );
        const allReceived = manifest.pending_units === 0 && manifest.total_units > 0;

        return (
          <Card key={manifest.manifest_id} className="overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-stone-800 p-4">
              <div>
                <p className="font-medium text-stone-100">{manifest.vessel_name}</p>
                <p className="font-mono text-sm text-brand-400">{manifest.cspo_number}</p>
                <p className="mt-1 text-xs text-stone-500">
                  {skuRows.length} SKUs · {manifest.received_units}/{manifest.total_units} units
                  scanned in
                </p>
              </div>
              <Badge variant="packing">{statusLabel(manifest.status)}</Badge>
            </div>

            <div className="border-b border-stone-800 px-3 py-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  value={search}
                  onChange={(e) =>
                    setSearchByManifest((prev) => ({
                      ...prev,
                      [manifest.manifest_id]: e.target.value,
                    }))
                  }
                  placeholder="Filter SKU…"
                  className="w-full rounded-md border border-stone-700 bg-stone-900 py-1.5 pl-10 pr-3 text-sm text-stone-100"
                />
              </div>
            </div>

            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-stone-950">
                  <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Pending</th>
                    <th className="px-3 py-2 text-right">Done</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60">
                  {filtered.map((row) => {
                    const full = skuRows.find((r) => r.sku_id === row.sku_id)!;
                    const key = `${manifest.manifest_id}-${row.sku_id}`;
                    const isDone = full.pending === 0;
                    return (
                      <RestockRow
                        key={key}
                        name={full.name}
                        skuCode={full.sku_code}
                        pending={full.pending}
                        received={full.received}
                        busy={busyKey === key}
                        done={isDone}
                        onReceive={(qty) => {
                          setSuccessMsg(null);
                          setBusyKey(key);
                          void receiveSku
                            .mutateAsync({
                              manifestId: manifest.manifest_id,
                              skuId: row.sku_id,
                              qty,
                            })
                            .then((res) => {
                              if (res.queued) {
                                setSuccessMsg(
                                  `Saved offline — ${res.result.received}× ${full.name} queued for restock`,
                                );
                              }
                            })
                            .finally(() => setBusyKey(null));
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>

            {allReceived && manifest.status !== "received" && (
              <div className="p-4">
                <Button
                  className="w-full"
                  disabled={completeReceipt.isPending}
                  onClick={() => {
                    setSuccessMsg(null);
                    void completeReceipt
                      .mutateAsync(manifest.manifest_id)
                      .then((res) => {
                        if (res.queued) {
                          setSuccessMsg(
                            `Saved offline — ${manifest.cspo_number} restock queued to complete`,
                          );
                        }
                      });
                  }}
                >
                  {completeReceipt.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <PackageCheck className="h-4 w-4" /> Complete restock
                    </>
                  )}
                </Button>
              </div>
            )}
          </Card>
        );
      })}

      {receiveSku.error && (
        <p className="text-sm text-red-400">{(receiveSku.error as Error).message}</p>
      )}
    </div>
  );
}

function RestockRow({
  name,
  skuCode,
  pending,
  received,
  busy,
  done,
  onReceive,
}: {
  name: string;
  skuCode: string;
  pending: number;
  received: number;
  busy: boolean;
  done: boolean;
  onReceive: (qty: number) => void;
}) {
  const [qtyInput, setQtyInput] = useState("1");
  const qty = Math.max(1, Math.min(parseInt(qtyInput, 10) || 1, pending));

  return (
    <tr className={cn(done && "bg-emerald-950/10")}>
      <td className="px-3 py-2.5">
        <p className="text-stone-100">{name}</p>
        <p className="font-mono text-xs text-stone-500">{skuCode}</p>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-stone-300">{pending}</td>
      <td className="px-3 py-2.5 text-right font-mono text-emerald-400/80">{received}</td>
      <td className="px-3 py-2.5">
        {!done && (
          <input
            type="number"
            min={1}
            max={pending}
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            className="ml-auto block w-14 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right font-mono text-xs"
          />
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {done ? (
          <Check className="ml-auto h-4 w-4 text-emerald-400" />
        ) : (
          <Button size="sm" disabled={busy} onClick={() => onReceive(qty)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Scan in"}
          </Button>
        )}
      </td>
    </tr>
  );
}
