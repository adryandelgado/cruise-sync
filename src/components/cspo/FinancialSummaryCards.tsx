import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

type Summary = {
  open_balance: number;
  consumed_value: number;
  installed_value: number;
  returned_value: number;
  transferred_out_value: number;
  transferred_in_value: number;
  has_initial_ledger?: boolean;
};

type Props = {
  currency: string;
  originalValue: number;
  summary: Summary | null | undefined;
  aboardLabel: string;
  loading?: boolean;
};

export function FinancialSummaryCards({
  currency,
  originalValue,
  summary,
  aboardLabel,
  loading,
}: Props) {
  const fmt = (n: number) => formatCurrency(n, currency);
  const consumed = summary ? summary.consumed_value + summary.installed_value : 0;
  const returned = summary?.returned_value ?? 0;
  const xferOut = summary?.transferred_out_value ?? 0;
  const xferIn = summary?.transferred_in_value ?? 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="flex flex-col gap-1 p-4">
        <span className="text-xs text-stone-500">Original PO</span>
        <span className="text-xl font-semibold tracking-tight text-stone-100">
          {fmt(originalValue)}
        </span>
        <span className="text-xs text-stone-600">As issued</span>
      </Card>

      <Card className="flex flex-col gap-1 p-4">
        <span className="text-xs text-stone-500">Open balance</span>
        <span className="text-xl font-semibold tracking-tight text-emerald-300">
          {loading ? "…" : summary ? fmt(summary.open_balance) : "—"}
        </span>
        <span className="text-xs text-stone-600">Live from ledger</span>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <span className="text-xs text-stone-500">Value movements</span>
        {loading || !summary ? (
          <span className="text-xl font-semibold text-stone-500">…</span>
        ) : (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-stone-500">Consumed</dt>
              <dd className="font-mono text-amber-300">{fmt(consumed)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-stone-500">Returned</dt>
              <dd className="font-mono text-sky-300">{fmt(returned)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-stone-500">Xfer out / in</dt>
              <dd className="font-mono text-violet-300">
                {fmt(xferOut)} / {fmt(xferIn)}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <Card className="flex flex-col gap-1 p-4">
        <span className="text-xs text-stone-500">Units aboard</span>
        <span className="text-xl font-semibold tracking-tight text-stone-100">
          {loading && !summary ? "…" : aboardLabel}
        </span>
        <span className="text-xs text-stone-600">Trackable on vessel</span>
      </Card>
    </div>
  );
}
