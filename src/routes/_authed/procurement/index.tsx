import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Package, ScanLine } from "lucide-react";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { JobListToolbar } from "@/components/shared/JobListToolbar";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useProcurementHub,
  useReceiveProcurement,
  type ProcurementRequestRow,
} from "@/hooks/useProcurement";
import {
  PROCUREMENT_STATUS_FILTERS,
} from "@/lib/procurementListFilters";
import { ensureProcurementHub } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";

export const Route = createFileRoute("/_authed/procurement/")({
  loader: ({ context: { queryClient } }) => ensureProcurementHub(queryClient),
  component: ProcurementPage,
});

function skuMeta(req: ProcurementRequestRow) {
  return req.sku as { id: string; sku_code: string; name: string } | null;
}

function findProcurementMatch(requests: ProcurementRequestRow[], code: string) {
  const pending = requests.filter(
    (req) => Number(req.qty_needed) - Number(req.qty_received) > 0,
  );
  return (
    pending.find((req) => skuMeta(req)?.sku_code.toUpperCase() === code) ??
    pending.find((req) => skuMeta(req)?.sku_code.toUpperCase().startsWith(code))
  );
}

function ProcurementPage() {
  const { data: hub, isPending, error } = useProcurementHub();
  const loading = isInitialQueryLoad(isPending, hub);
  const requests = hub?.requests ?? [];
  const summary = hub?.summary;
  const receive = useReceiveProcurement();
  const [receivedCspo, setReceivedCspo] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return (requests ?? []).filter((req) => {
      if (statusFilter && req.status !== statusFilter) return false;
      if (!q) return true;
      const sku = skuMeta(req);
      const cspo = req.cspo as { cspo_number: string } | null;
      return (
        sku?.sku_code?.toUpperCase().includes(q) ||
        sku?.name?.toUpperCase().includes(q) ||
        cspo?.cspo_number?.toUpperCase().includes(q)
      );
    });
  }, [requests, search, statusFilter]);

  async function handleReceive(requestId: string, qty: number, skuName?: string) {
    setSuccessMsg(null);
    const result = await receive.mutateAsync({ requestId, qty });
    if (result.queued) {
      setSuccessMsg(
        `Saved offline — ${result.qtyReceived}× ${skuName ?? "item"} queued for procurement receive`,
      );
    }
    if (result.cspoId) {
      setReceivedCspo(result.cspoId);
    }
  }

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const code = scanValue.trim().toUpperCase();
    if (!code || !requests) return;

    const match = findProcurementMatch(requests, code);
    if (!match) {
      setScanError(`No open request for SKU "${code}".`);
      setScanValue("");
      return;
    }

    setScanError(null);
    const remaining = Number(match.qty_needed) - Number(match.qty_received);
    void handleReceive(match.id, remaining, skuMeta(match)?.name).then(() => {
      setScanValue("");
      scanRef.current?.focus();
    });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Procurement</h1>
        <p className="text-sm text-stone-400">
          Stock-outs from warehouse packing land here. Receive against open requests.
        </p>
        {summary && summary.openCount > 0 && (
          <p className="mt-2 text-xs text-stone-500">
            {summary.openCount} open request{summary.openCount === 1 ? "" : "s"}
            {summary.pendingUnits > 0 && (
              <span> · {summary.pendingUnits} unit{summary.pendingUnits === 1 ? "" : "s"} pending</span>
            )}
          </p>
        )}
      </header>

      {successMsg && (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          {successMsg}
        </div>
      )}

      {receivedCspo && (
        <div className="flex items-center justify-between rounded-md border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Stock received — warehouse pack job updated.
          </span>
          <Link to="/warehouse/pack/$cspoId" params={{ cspoId: receivedCspo }} className="text-brand-400 hover:underline">
            Continue packing →
          </Link>
        </div>
      )}

      {receive.error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {(receive.error as Error).message}
        </div>
      )}

      {loading && <div className="py-12 text-center text-sm text-stone-500">Loading…</div>}
      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!loading && !error && requests.length === 0 && (
        <Card className="py-16 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-stone-700" />
          <p className="font-medium text-stone-300">No open requests</p>
          <p className="mt-1 text-sm text-stone-500">
            Flag items as not-in-stock during warehouse packing to create requests.
          </p>
        </Card>
      )}

      {requests && requests.length > 0 && (
        <>
          <JobListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search SKU or CSPO #…"
            filters={[...PROCUREMENT_STATUS_FILTERS]}
            activeFilter={statusFilter}
            onFilter={setStatusFilter}
            count={filtered.length}
            total={requests.length}
            countLabel="requests"
          />

          <Card className="p-4">
            <form onSubmit={handleScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  ref={scanRef}
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  placeholder="Scan SKU to receive remaining qty…"
                  className="w-full rounded-md border border-stone-700 bg-stone-900 py-2.5 pl-10 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <Button type="submit" variant="secondary" disabled={receive.isPending}>
                Scan
              </Button>
            </form>
            {scanError && <p className="mt-2 text-xs text-amber-400">{scanError}</p>}
          </Card>
        </>
      )}

      {requests && requests.length > 0 && filtered.length === 0 && (
        <Card className="py-12 text-center text-sm text-stone-500">
          No requests match your filters
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((req) => {
          const sku = skuMeta(req);
          const cspo = req.cspo as { cspo_number: string } | null;
          const remaining = Number(req.qty_needed) - Number(req.qty_received);

          return (
            <Card key={req.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-stone-100">{sku?.name ?? "SKU"}</p>
                <p className="font-mono text-xs text-stone-500">{sku?.sku_code}</p>
                <p className="mt-1 text-xs text-stone-400">
                  Need {req.qty_needed} · Received {req.qty_received}
                  {cspo?.cspo_number && ` · CSPO ${cspo.cspo_number}`}
                </p>
                {req.notes && <p className="text-xs text-stone-600">{req.notes}</p>}
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="packing">{statusLabel(req.status)}</Badge>
                {remaining > 0 && (
                  <Button
                    size="sm"
                    disabled={receive.isPending}
                    onClick={() => void handleReceive(req.id, remaining, sku?.name)}
                  >
                    {receive.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Receive ${remaining}`}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
