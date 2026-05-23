import { memo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardSkuRow } from "@/lib/onboardUsage";

type Props = {
  row: OnboardSkuRow;
  mode: "return" | "transfer";
  onManifest: number;
  disabled: boolean;
  busy: boolean;
  canTransfer: boolean;
  onAction: (skuId: string, qty: number) => void;
};

export const ReturnSkuRow = memo(function ReturnSkuRow({
  row,
  mode,
  onManifest,
  disabled,
  busy,
  canTransfer,
  onAction,
}: Props) {
  const [qtyInput, setQtyInput] = useState("1");
  const available = row.on_vessel;
  const qty = Math.max(1, Math.min(parseInt(qtyInput, 10) || 1, available));

  return (
    <tr>
      <td className="px-3 py-2.5">
        <p className="truncate text-sm text-stone-100">{row.name}</p>
        <p className="font-mono text-xs text-stone-500">{row.sku_code}</p>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm text-stone-300">
        {available}
      </td>
      {mode === "return" && (
        <td className="px-3 py-2.5 text-right font-mono text-xs text-stone-500">
          {onManifest > 0 ? onManifest : "—"}
        </td>
      )}
      <td className="px-3 py-2.5">
        <input
          type="number"
          min={1}
          max={available}
          value={qtyInput}
          onChange={(e) => setQtyInput(e.target.value)}
          className="ml-auto block w-16 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right font-mono text-xs text-stone-100"
        />
      </td>
      <td className="px-3 py-2.5 text-right">
        <Button
          size="sm"
          disabled={disabled || (mode === "transfer" && !canTransfer)}
          onClick={() => onAction(row.sku_id, qty)}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {mode === "return"
            ? qty >= available
              ? "Add all"
              : `Add ${qty}`
            : qty >= available
              ? "Transfer all"
              : `Transfer ${qty}`}
        </Button>
      </td>
    </tr>
  );
});
