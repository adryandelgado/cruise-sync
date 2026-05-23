import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Check, Loader2, PackageCheck, ScanLine, AlertTriangle } from "lucide-react";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  canWorkAboard,
  useOnboardSkuInventory,
  useReceivePackage,
  useReceiveSession,
} from "@/hooks/useOnboard";
import { ensureReceiveSession } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/onboard/receive/$cspoId")({
  loader: ({ context: { queryClient }, params: { cspoId } }) =>
    ensureReceiveSession(queryClient, cspoId),
  component: ReceivePage,
});

function ReceivePage() {
  const { cspoId } = Route.useParams();
  const { data, isPending, error } = useReceiveSession(cspoId);
  const { data: inventory } = useOnboardSkuInventory(cspoId);
  const receive = useReceivePackage();
  const [scanValue, setScanValue] = useState("");
  const [showReceived, setShowReceived] = useState(false);
  const [receivingAll, setReceivingAll] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const pending = data?.packages.filter((p) => !p.received) ?? [];
  const received = data?.packages.filter((p) => p.received) ?? [];
  const packages = data?.packages ?? [];

  const unitStats = useMemo(() => {
    const rows = inventory ?? [];
    const units = rows.reduce((s, r) => s + r.aboard, 0);
    return { skus: rows.length, units };
  }, [inventory]);

  async function receivePackage(packageId: string, notes?: string) {
    await receive.mutateAsync({ packageId, cspoId, notes });
    setScanValue("");
    scanRef.current?.focus();
  }

  async function receiveAllPending(pendingIds: string[]) {
    setReceivingAll(true);
    try {
      for (const id of pendingIds) {
        await receive.mutateAsync({ packageId: id, cspoId });
      }
    } finally {
      setReceivingAll(false);
    }
  }

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const num = parseInt(scanValue.trim(), 10);
    if (!num || !data) return;

    const pkg = data.packages.find(
      (p) => p.package_number === num && !p.received,
    );
    if (pkg) void receivePackage(pkg.id);
    setScanValue("");
  }

  if (isInitialQueryLoad(isPending, data)) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading…</div>;
  }

  if (error || !data) {
    return (
      <div className="py-24 text-center text-sm text-red-400">
        {(error as Error)?.message ?? "Not found"}
      </div>
    );
  }

  const { cspo } = data;
  const vessel = cspo.vessel as unknown as {
    name: string;
    fleet: { name: string } | null;
  } | null;

  const allReceived = pending.length === 0 && packages.length > 0;
  const working = canWorkAboard(cspo.status);
  const canUseOnboard = unitStats.units > 0;
  const visible = showReceived ? packages : pending;
  const totalTrackable = packages.reduce((s, p) => s + p.trackable_count, 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-16">
      <Link
        to="/onboard"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> Onboard
      </Link>

      <div>
        <h1 className="font-mono text-xl font-semibold">{cspo.cspo_number}</h1>
        <p className="text-sm text-stone-400">
          {vessel?.name} — receive freight packages aboard
        </p>
        <p className="mt-1 text-sm text-stone-500">
          {received.length} / {packages.length} packages received
          {unitStats.units > 0 && (
            <span>
              {" "}
              · {unitStats.skus} SKUs · {unitStats.units} units aboard
            </span>
          )}
          {totalTrackable > 0 && unitStats.units === 0 && received.length > 0 && (
            <span className="text-amber-400"> · {totalTrackable} trackable units in shipment</span>
          )}
        </p>
      </div>

      {!allReceived && packages.length > 0 && (
        <Card className="p-4">
          <form onSubmit={handleScan} className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
              <input
                ref={scanRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                placeholder="Enter package # to receive…"
                className={inputClass}
                autoFocus
              />
            </div>
            <Button type="submit" variant="secondary">
              Scan
            </Button>
          </form>
          {pending.length > 1 && (
            <Button
              className="mt-3 w-full"
              disabled={receive.isPending || receivingAll}
              onClick={() => void receiveAllPending(pending.map((p) => p.id))}
            >
              {receivingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="h-4 w-4" />
              )}
              Receive all pending ({pending.length})
            </Button>
          )}
        </Card>
      )}

      {allReceived && (canUseOnboard || working) && (
        <Card className="border-emerald-900/40 bg-emerald-950/20 p-4 text-center">
          <Check className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
          <p className="font-medium text-emerald-300">
            All packages received
            {canUseOnboard &&
              ` — ${unitStats.units} units aboard (${unitStats.skus} SKUs)`}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link to="/onboard/log/$cspoId" params={{ cspoId }}>
              <Button size="sm">Daily log</Button>
            </Link>
            <Link to="/cspos/$cspoId" params={{ cspoId }}>
              <Button variant="secondary" size="sm">
                CSPO & close
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {allReceived && !canUseOnboard && !working && (
        <Card className="border-amber-900/40 bg-amber-950/20 p-4">
          <p className="flex items-center gap-2 font-medium text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Received, but 0 trackable units aboard
          </p>
          <p className="mt-2 text-sm text-amber-200/70">
            Custom-only packages do not create inventory — daily log and returns stay disabled.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-400">
            <li>
              <Link to="/cspos/$cspoId" params={{ cspoId }} className="text-brand-400 hover:underline">
                CSPO detail
              </Link>{" "}
              → add catalog SKUs
            </li>
            <li>
              <Link to="/warehouse/pack/$cspoId" params={{ cspoId }} className="text-brand-400 hover:underline">
                Warehouse
              </Link>{" "}
              → pack and ship supplemental pallet
            </li>
            <li>Return here and receive the new package</li>
          </ol>
        </Card>
      )}

      {packages.length > 0 && (
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setShowReceived(false)}
            className={cn(
              "rounded-md px-2.5 py-1",
              !showReceived ? "bg-stone-800 text-stone-100" : "text-stone-500",
            )}
          >
            Pending ({pending.length})
          </button>
          <button
            type="button"
            onClick={() => setShowReceived(true)}
            className={cn(
              "rounded-md px-2.5 py-1",
              showReceived ? "bg-stone-800 text-stone-100" : "text-stone-500",
            )}
          >
            {showReceived ? `All (${packages.length})` : `Received (${received.length})`}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <Card className="py-8 text-center text-sm text-stone-500">
            {showReceived ? "No packages yet." : "All packages received — switch to Received tab."}
          </Card>
        ) : (
          visible.map((pkg) => (
            <Card
              key={pkg.id}
              className={cn(
                "flex items-center justify-between p-4",
                pkg.received && "border-emerald-900/30 bg-emerald-950/10",
              )}
            >
              <div>
                <p className="font-medium capitalize text-stone-100">
                  {statusLabel(pkg.package_type)} #{pkg.package_number}
                </p>
                {pkg.receipt && (
                  <p className="text-xs text-stone-500">
                    Received {new Date(pkg.receipt.received_at).toLocaleString()}
                  </p>
                )}
                <p className="text-xs text-stone-500">
                  {pkg.trackable_count} units trackable
                  {pkg.custom_count > 0 && ` · ${pkg.custom_count} custom`}
                </p>
              </div>
              {pkg.received ? (
                <Badge variant="on_vessel">Received</Badge>
              ) : pkg.status === "open" ? (
                <Button
                  size="lg"
                  disabled={receive.isPending || receivingAll || pkg.trackable_count + pkg.custom_count === 0}
                  onClick={() => void receivePackage(pkg.id)}
                >
                  {receive.isPending || receivingAll ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Seal & receive"
                  )}
                </Button>
              ) : (
                <Button
                  size="lg"
                  disabled={receive.isPending || receivingAll}
                  onClick={() => void receivePackage(pkg.id)}
                >
                  {receive.isPending || receivingAll ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Receive"
                  )}
                </Button>
              )}
            </Card>
          ))
        )}
      </div>

      {receive.error && (
        <p className="text-sm text-red-400">{(receive.error as Error).message}</p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 py-3 pl-10 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
