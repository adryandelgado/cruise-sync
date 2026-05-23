import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  aggregateLedgerEntries,
  type LedgerEntryRow,
} from "@/lib/cspoFinancial";
import { formatCurrency } from "@/lib/utils";
import { statusLabel } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const LEDGER_PREVIEW = 20;

type Props = {
  currency: string;
  entries: LedgerEntryRow[];
  isLoading?: boolean;
  defaultCollapsed?: boolean;
};

export function ValueLedgerSection({
  currency,
  entries,
  isLoading,
  defaultCollapsed = false,
}: Props) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const aggregated = useMemo(() => aggregateLedgerEntries(entries), [entries]);
  const needsCollapse = aggregated.length > LEDGER_PREVIEW;
  const startIdx =
    expanded || !needsCollapse ? 0 : Math.max(0, aggregated.length - LEDGER_PREVIEW);
  const visible = aggregated.slice(startIdx);

  const runningBalances = useMemo(() => {
    let run = 0;
    return aggregated.map((e) => {
      run += e.amount;
      return run;
    });
  }, [aggregated]);

  if (isLoading) {
    return (
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
          Value ledger
        </h2>
        <Card className="py-8 text-center text-sm text-stone-500">Loading ledger…</Card>
      </section>
    );
  }

  if (!entries.length) {
    return (
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
          Value ledger
        </h2>
        <Card className="py-8 text-center text-sm text-stone-500">
          No ledger entries yet — initial PO value is recorded when the CSPO is created.
        </Card>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
          Value ledger
          <span className="ml-2 normal-case text-stone-600">
            ({aggregated.length} entries · {entries.length} movements)
          </span>
        </h2>
        {needsCollapse && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Show recent only
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> Show all {aggregated.length}
              </>
            )}
          </Button>
        )}
      </div>
      {!expanded && needsCollapse && (
        <p className="mb-2 text-xs text-stone-600">
          Showing last {LEDGER_PREVIEW} ledger entries — expand for full history.
        </p>
      )}
      <Card className="overflow-hidden">
        <div className="max-h-[min(50vh,420px)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-stone-950">
              <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {visible.map((e, i) => {
                const balance = runningBalances[startIdx + i] ?? 0;
                return (
                  <tr key={e.id}>
                    <td className="px-4 py-3 text-stone-500">
                      {new Date(e.occurred_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 capitalize text-stone-300">
                      {statusLabel(e.entry_type)}
                    </td>
                    <td className="px-4 py-3 text-stone-400">
                      {e.qty > 1 && (
                        <span className="mr-1.5 font-mono text-brand-400">{e.qty}×</span>
                      )}
                      <span className="font-mono text-stone-300">{e.sku_code}</span>
                      {e.sku_name && e.sku_name !== e.sku_code && (
                        <span className="ml-1.5 text-stone-600">{e.sku_name}</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono ${e.amount >= 0 ? "text-emerald-400" : "text-amber-400"}`}
                    >
                      {e.amount >= 0 ? "+" : ""}
                      {formatCurrency(e.amount, currency)}
                      {e.qty > 1 && (
                        <span className="ml-1 text-xs text-stone-600">
                          ({formatCurrency(e.unit_amount, currency)} ea)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-stone-200">
                      {formatCurrency(balance, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
