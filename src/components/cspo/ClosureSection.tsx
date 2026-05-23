import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCloseCspo, useClosureReport, useCspoBlockingInventory } from "@/hooks/useClosure";
import {
  useAcknowledgeTransfer,
  useOutboundPendingTransfers,
} from "@/hooks/useOnboard";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { formatCurrency, cn } from "@/lib/utils";

type SummaryLike = {
  consumed_value?: number | null;
  installed_value?: number | null;
  returned_value?: number | null;
  transferred_out_value?: number | null;
  open_balance?: number | null;
  items_on_vessel?: number | null;
};

type Props = {
  cspoId: string;
  cspoStatus: string;
  summary?: SummaryLike | null;
};

export function ClosureSection({ cspoId, cspoStatus, summary }: Props) {
  const { data: report, isPending, error } = useClosureReport(cspoId);
  const { data: blocking, error: blockingError } = useCspoBlockingInventory(cspoId);
  const { data: outboundTransfers } = useOutboundPendingTransfers(cspoId);
  const acknowledgeTransfer = useAcknowledgeTransfer();
  const closeCspo = useCloseCspo();
  const [notes, setNotes] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [closeSuccessMsg, setCloseSuccessMsg] = useState<string | null>(null);

  if (cspoStatus === "closed") {
    return (
      <Card className="p-4">
        <p className="text-sm text-stone-400">This CSPO is closed.</p>
      </Card>
    );
  }

  if (cspoStatus === "cancelled") {
    return null;
  }

  const merged = report ?? (summary
    ? {
        consumed_value: summary.consumed_value ?? 0,
        installed_value: summary.installed_value ?? 0,
        returned_value: summary.returned_value ?? 0,
        transferred_out_value: summary.transferred_out_value ?? 0,
        open_balance: summary.open_balance ?? 0,
        variance_pct: 0,
        items_still_aboard: summary.items_on_vessel ?? 0,
      }
    : null);

  const canClose =
    cspoStatus === "in_progress" ||
    cspoStatus === "on_vessel" ||
    cspoStatus === "closing";

  const groupedBlockers = blocking?.groups ?? [];

  const groupedOutbound = (() => {
    const map = new Map<
      string,
      { sku_code: string; name: string; qty: number; value: number; currency: string; to_cspo_id: string; to_number: string; ids: string[] }
    >();
    for (const t of outboundTransfers ?? []) {
      const sku = (
        t.material_instance as unknown as {
          sku: { sku_code: string; name: string } | null;
        } | null
      )?.sku;
      const toCspo = t.to_cspo as unknown as { cspo_number: string } | null;
      const key = `${sku?.sku_code ?? "?"}→${t.to_cspo_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.qty += 1;
        existing.value += Number(t.transferred_value);
        existing.ids.push(t.id);
      } else {
        map.set(key, {
          sku_code: sku?.sku_code ?? "Item",
          name: sku?.name ?? "Item",
          qty: 1,
          value: Number(t.transferred_value),
          currency: t.currency,
          to_cspo_id: t.to_cspo_id,
          to_number: toCspo?.cspo_number ?? "CSPO",
          ids: [t.id],
        });
      }
    }
    return [...map.values()];
  })();

  const itemsAboard = Number(merged?.items_still_aboard ?? summary?.items_on_vessel ?? 0);
  const outboundCount = outboundTransfers?.length ?? 0;
  const blockerCount = blocking?.blocker_count ?? 0;

  const checklist = [
    {
      id: "aboard",
      label: "No trackable units still aboard",
      done: itemsAboard === 0,
      hint:
        itemsAboard > 0
          ? `${itemsAboard} unit(s) — return or transfer first`
          : "Cleared",
      href: itemsAboard > 0 ? `/onboard/returns/${cspoId}` : undefined,
    },
    {
      id: "blockers",
      label: "No blocking inventory statuses",
      done: groupedBlockers.length === 0,
      hint:
        blockerCount > 0
          ? `${blockerCount} unit(s) in packed / in transit / allocated`
          : "Clear",
      href: groupedBlockers.length > 0 ? `/onboard/returns/${cspoId}` : undefined,
    },
    {
      id: "outbound",
      label: "Outbound transfers acknowledged",
      done: outboundCount === 0,
      hint:
        outboundCount > 0
          ? `${outboundCount} pending on receiving CSPO(s)`
          : "None pending",
    },
    {
      id: "status",
      label: "CSPO in aboard work phase",
      done: canClose,
      hint: canClose ? "Ready for sign-off" : "Receive packages and start work aboard first",
    },
  ];

  const closeBlocked =
    itemsAboard > 0 ||
    groupedBlockers.length > 0 ||
    outboundCount > 0 ||
    !canClose;

  async function handleClose(e: FormEvent) {
    e.preventDefault();
    if (closeBlocked) return;
    setCloseSuccessMsg(null);
    const res = await closeCspo.mutateAsync({ cspoId, notes: notes.trim() || undefined });
    if (res.queued) {
      setCloseSuccessMsg("Saved offline — CSPO close queued to sync when you're back online.");
    }
    setShowClose(false);
  }

  async function acknowledgeAllOutbound() {
    if (!outboundTransfers?.length) return;
    for (const t of outboundTransfers) {
      await acknowledgeTransfer.mutateAsync(t.id);
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
        Closure report
      </h2>
      <Card className="p-4">
        {isInitialQueryLoad(isPending, report) && !merged && (
          <p className="text-sm text-stone-500">Loading closure data…</p>
        )}

        {error && !merged && (
          <p className="text-sm text-red-400">
            Could not load closure report: {(error as Error).message}
          </p>
        )}

        {merged && (
          <>
            {blockingError && (
              <p className="mb-4 text-xs text-amber-400">
                Could not load blocking inventory summary: {(blockingError as Error).message}
              </p>
            )}
            <div className="mb-4 rounded-md border border-stone-800 bg-stone-900/30 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">
                Close checklist
              </p>
              <ul className="space-y-2 text-sm">
                {checklist.map((item) => {
                  const row = (
                    <span className="flex items-start gap-2">
                      {item.done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-stone-600" />
                      )}
                      <span>
                        <span className={cn(item.done ? "text-stone-300" : "text-stone-400")}>
                          {item.label}
                        </span>
                        <span className="block text-xs text-stone-600">{item.hint}</span>
                      </span>
                    </span>
                  );
                  return (
                    <li key={item.id}>
                      {item.href && !item.done ? (
                        <Link to={item.href} className="hover:text-brand-300">
                          {row}
                        </Link>
                      ) : (
                        row
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
              {"variance_pct" in merged && (
                <>
                  <span className="text-stone-400">Variance</span>
                  <Badge
                    variant={Number(merged.variance_pct) === 0 ? "on_vessel" : "packing"}
                  >
                    {merged.variance_pct}%
                  </Badge>
                </>
              )}
              {Number(merged.items_still_aboard) > 0 && (
                <span className="text-amber-400">
                  {merged.items_still_aboard} unit(s) still aboard —{" "}
                  <Link to="/onboard/returns/$cspoId" params={{ cspoId }} className="underline">
                    transfer or return
                  </Link>{" "}
                  before closing
                </span>
              )}
            </div>

            {groupedOutbound.length > 0 && (
              <div className="mb-4 rounded-md border border-violet-900/40 bg-violet-950/20 p-3 text-xs">
                <p className="font-medium text-violet-200">
                  {outboundTransfers!.length} outbound transfer(s) awaiting acknowledgement
                </p>
                <p className="mt-1 text-stone-500">
                  The receiving CSPO must acknowledge before this PO can close.
                </p>
                <ul className="mt-2 space-y-2 text-stone-400">
                  {groupedOutbound.map((row) => (
                    <li
                      key={`${row.sku_code}-${row.to_cspo_id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-stone-800/80 px-2 py-1.5"
                    >
                      <span>
                        {row.qty > 1 && (
                          <span className="mr-1 font-mono text-brand-400">{row.qty}×</span>
                        )}
                        {row.sku_code} →{" "}
                        <Link
                          to="/cspos/$cspoId"
                          params={{ cspoId: row.to_cspo_id }}
                          className="font-mono text-brand-400 hover:underline"
                        >
                          {row.to_number}
                        </Link>
                        {" · "}
                        {formatCurrency(row.value, row.currency)}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={acknowledgeTransfer.isPending}
                        onClick={() => {
                          void Promise.all(
                            row.ids.map((id) => acknowledgeTransfer.mutateAsync(id)),
                          );
                        }}
                      >
                        Acknowledge{row.qty > 1 ? ` ${row.qty}` : ""}
                      </Button>
                    </li>
                  ))}
                </ul>
                {outboundTransfers!.length > 1 && (
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={acknowledgeTransfer.isPending}
                    onClick={() => void acknowledgeAllOutbound()}
                  >
                    Acknowledge all ({outboundTransfers!.length})
                  </Button>
                )}
              </div>
            )}

            {groupedBlockers.length > 0 && (
              <div className="mb-4 rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200/80">
                <p className="font-medium text-amber-200">
                  {blockerCount} unit(s) blocking close · {groupedBlockers.length} SKUs
                </p>
                <ul className="mt-2 space-y-1 text-stone-400">
                  {groupedBlockers.map((b) => (
                    <li key={b.sku_code}>
                      {b.qty > 1 && (
                        <span className="mr-1 font-mono text-brand-400">{b.qty}×</span>
                      )}
                      {b.sku_code} — {b.statuses.map((s) => s.replaceAll("_", " ")).join(", ")}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/onboard/returns/$cspoId"
                  params={{ cspoId }}
                  className="mt-2 inline-block text-brand-400 hover:underline"
                >
                  Open returns / transfers →
                </Link>
              </div>
            )}

            {closeSuccessMsg && (
              <p className="mb-4 rounded-md border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                {closeSuccessMsg}
              </p>
            )}

            {canClose && !showClose && (
              <Button
                variant="primary"
                size="sm"
                disabled={closeBlocked}
                onClick={() => setShowClose(true)}
              >
                Close CSPO
              </Button>
            )}

            {canClose && closeBlocked && !showClose && (
              <p className="mt-2 text-xs text-amber-400">
                Resolve all checklist items before closing.
              </p>
            )}

            {!canClose && (
              <p className="text-xs text-stone-500">
                CSPO must be in progress aboard before closure (receive packages first).
              </p>
            )}
          </>
        )}

        {showClose && (
          <form
            onSubmit={(e) => void handleClose(e)}
            className="mt-4 flex flex-col gap-3 border-t border-stone-800 pt-4"
          >
            <textarea
              rows={2}
              placeholder="Closure notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100"
            />
            {closeCspo.error && (
              <p className="text-xs text-red-400">{(closeCspo.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowClose(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={closeCspo.isPending || closeBlocked}>
                {closeCspo.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Sign off & close"
                )}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}
