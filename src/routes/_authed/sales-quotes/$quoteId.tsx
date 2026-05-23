import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSalesQuote, useUpdateSalesQuoteStatus } from "@/hooks/useProcurement";
import { ensureSalesQuoteDetail } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { salesQuoteBadgeVariant } from "@/lib/salesQuoteListFilters";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/sales-quotes/$quoteId")({
  loader: ({ context: { queryClient }, params: { quoteId } }) =>
    ensureSalesQuoteDetail(queryClient, quoteId),
  component: SalesQuoteDetailPage,
});

function SalesQuoteDetailPage() {
  const { quoteId } = Route.useParams();
  const { data, isPending, error } = useSalesQuote(quoteId);
  const updateStatus = useUpdateSalesQuoteStatus();

  if (isInitialQueryLoad(isPending, data)) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading…</div>;
  }

  if (error || !data?.quote) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-red-400">{(error as Error)?.message ?? "Not found"}</p>
        <Link to="/sales-quotes" className="mt-3 inline-block text-xs text-stone-500 underline">
          Back to sales quotes
        </Link>
      </div>
    );
  }

  const { quote, lines } = data;
  const vessel = quote.vessel as unknown as {
    name: string;
    fleet?: { name: string } | null;
  } | null;
  const isTerminal = quote.status === "accepted" || quote.status === "rejected" || quote.status === "expired";

  async function setStatus(status: "sent" | "accepted" | "rejected" | "expired") {
    await updateStatus.mutateAsync({ quoteId, status });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link
        to="/sales-quotes"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> All sales quotes
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{quote.quote_number}</h1>
            <Badge variant={salesQuoteBadgeVariant(quote.status)}>
              {statusLabel(quote.status)}
            </Badge>
          </div>
          <p className="text-sm text-stone-400">
            {vessel?.name ?? "No vessel"}
            {vessel?.fleet?.name ? ` · ${vessel.fleet.name}` : ""}
          </p>
          {quote.valid_until && (
            <p className="text-xs text-stone-500">
              Valid until{" "}
              {new Date(quote.valid_until).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
        </div>

        {!isTerminal && (
          <div className="flex flex-wrap gap-2">
            {quote.status === "draft" && (
              <Button
                size="sm"
                disabled={updateStatus.isPending}
                onClick={() => void setStatus("sent")}
              >
                {updateStatus.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Mark sent
              </Button>
            )}
            {(quote.status === "draft" || quote.status === "sent") && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={updateStatus.isPending}
                  onClick={() => void setStatus("accepted")}
                >
                  <ThumbsUp className="h-4 w-4" /> Accept
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={updateStatus.isPending}
                  onClick={() => void setStatus("rejected")}
                >
                  <ThumbsDown className="h-4 w-4" /> Reject
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
              <th className="px-4 py-3 font-medium text-right">Unit</th>
              <th className="px-4 py-3 font-medium text-right">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800/60">
            {lines.map((line) => {
              const sku = line.sku as unknown as { sku_code: string; name: string } | null;
              const qty = Number(line.qty);
              const unit = Number(line.unit_price);
              return (
                <tr key={line.id}>
                  <td className="px-4 py-3 font-mono text-brand-400">{sku?.sku_code ?? "—"}</td>
                  <td className="px-4 py-3 text-stone-300">{sku?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{qty}</td>
                  <td className="px-4 py-3 text-right font-mono text-stone-400">
                    {formatCurrency(unit, quote.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(qty * unit, quote.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-stone-800">
              <td colSpan={4} className="px-4 py-3 text-right font-medium text-stone-400">
                Total
              </td>
              <td className="px-4 py-3 text-right font-mono text-lg font-semibold">
                {formatCurrency(Number(quote.total), quote.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {updateStatus.error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {(updateStatus.error as Error).message}
        </div>
      )}
    </div>
  );
}
