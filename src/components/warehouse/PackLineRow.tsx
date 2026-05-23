import { memo, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PackSession } from "@/hooks/usePackJobs";
import { cn } from "@/lib/utils";

type LineItem = PackSession["list"]["items"][number];

type Props = {
  item: LineItem;
  activePackageId: string | null;
  stockBySku: Record<string, number>;
  isPacking: boolean;
  packingLineId: string | null;
  onPack: (listItemId: string, isCustom: boolean, qty: number) => void;
  onRequestProcurement: (item: LineItem, remaining: number, skuCode: string) => void;
  isProcuring: boolean;
};

export const PackLineRow = memo(function PackLineRow({
  item,
  activePackageId,
  stockBySku,
  isPacking,
  packingLineId,
  onPack,
  onRequestProcurement,
  isProcuring,
}: Props) {
  const [qtyInput, setQtyInput] = useState("");

  const requestedQty = Number(item.requested_qty);
  const packedQty = Number(item.packed_qty);
  const remaining = Math.max(requestedQty - packedQty, 0);
  const done = remaining <= 0;
  const label = item.sku ? item.sku.name : item.custom_description ?? "Custom item";
  const sub = item.sku?.sku_code ?? "Custom";
  const onHand = item.sku_id ? (stockBySku[item.sku_id] ?? 0) : null;
  const short = onHand !== null && onHand < remaining;
  const pr = item.procurement_request as unknown as { status: string } | null;
  const procuring =
    item.status === "procuring" &&
    (!pr || ["open", "ordered", "partial"].includes(pr.status));
  const stockReceived =
    item.status === "pending" &&
    !!item.procurement_request_id &&
    pr &&
    ["received", "partial"].includes(pr.status);

  const packQty = Math.max(1, Math.min(parseInt(qtyInput, 10) || 1, remaining));
  const busy = isPacking && packingLineId === item.id;

  return (
    <tr
      className={cn(
        done && "bg-emerald-950/10",
        short && !done && "bg-amber-950/10",
      )}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {done ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0 rounded border border-stone-600" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm text-stone-100">{label}</p>
            <p className="font-mono text-xs text-stone-500">{sub}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm text-stone-300">
        {requestedQty}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm text-stone-400">
        {packedQty}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm">
        {done ? (
          <span className="text-emerald-400">0</span>
        ) : (
          <span className={cn(short && "text-amber-400")}>{remaining}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right text-xs text-stone-500">
        {onHand !== null ? (
          <span className={cn(short && "font-medium text-amber-400")}>
            {onHand}
            {short && " ⚠"}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2.5">
        {!done && activePackageId && (
          <div className="flex items-center justify-end gap-1.5">
            <input
              type="number"
              min={1}
              max={remaining}
              placeholder="1"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              className="w-14 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right font-mono text-xs text-stone-100"
            />
            <Button
              size="sm"
              disabled={isPacking}
              onClick={() => onPack(item.id, !item.sku_id, packQty)}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {packQty >= remaining ? "All" : packQty}
            </Button>
          </div>
        )}
        {done && (
          <Badge variant="on_vessel" className="float-right">
            {statusLabel(item.status)}
          </Badge>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {(short || procuring || stockReceived) && !done && item.sku_id && (
          procuring ? (
            <Badge variant="packing">Procuring</Badge>
          ) : stockReceived ? (
            <Badge variant="on_vessel">Ready</Badge>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={isProcuring}
              onClick={() => onRequestProcurement(item, remaining, sub)}
            >
              Procure
            </Button>
          )
        )}
      </td>
    </tr>
  );
});

export function computePackStats(items: LineItem[]) {
  let totalUnits = 0;
  let packedUnits = 0;
  let completeLines = 0;

  for (const item of items) {
    const req = Number(item.requested_qty);
    const packed = Number(item.packed_qty);
    totalUnits += req;
    packedUnits += Math.min(packed, req);
    if (packed >= req) completeLines += 1;
  }

  return {
    totalLines: items.length,
    completeLines,
    totalUnits,
    packedUnits,
    remainingUnits: totalUnits - packedUnits,
  };
}

export function packageUnitCount(
  contents: Array<{ qty: number }> | undefined,
): number {
  if (!contents?.length) return 0;
  return contents.reduce((sum, c) => sum + Number(c.qty), 0);
}
