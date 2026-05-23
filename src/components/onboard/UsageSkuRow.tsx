import { memo, useState } from "react";
import { Flame, Hammer, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardSkuRow } from "@/lib/onboardUsage";
import { cn } from "@/lib/utils";

const ACTIONS = [
  { type: "consumed" as const, label: "Used", icon: Flame, color: "text-amber-400" },
  { type: "installed" as const, label: "Installed", icon: Hammer, color: "text-emerald-400" },
  { type: "damaged" as const, label: "Damaged", icon: Trash2, color: "text-red-400" },
];

type Props = {
  row: OnboardSkuRow;
  isLogging: boolean;
  loggingSkuId: string | null;
  highlighted: boolean;
  onLog: (
    skuId: string,
    actionType: "consumed" | "installed" | "damaged",
    qty: number,
  ) => void;
};

export const UsageSkuRow = memo(function UsageSkuRow({
  row,
  isLogging,
  loggingSkuId,
  highlighted,
  onLog,
}: Props) {
  const [qtyInput, setQtyInput] = useState("1");
  const qty = Math.max(1, Math.min(parseInt(qtyInput, 10) || 1, row.on_vessel));
  const busy = isLogging && loggingSkuId === row.sku_id;

  return (
    <tr
      id={`sku-${row.sku_code}`}
      className={cn(highlighted && "bg-brand-950/30 ring-1 ring-inset ring-brand-700/50")}
    >
      <td className="px-3 py-2.5">
        <p className="truncate text-sm text-stone-100">{row.name}</p>
        <p className="font-mono text-xs text-stone-500">{row.sku_code}</p>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm text-stone-300">
        {row.on_vessel}
      </td>
      <td className="px-3 py-2.5 text-right text-xs text-stone-500">
        {row.unit_of_measure}
      </td>
      <td className="px-3 py-2.5">
        <input
          type="number"
          min={1}
          max={row.on_vessel}
          value={qtyInput}
          onChange={(e) => setQtyInput(e.target.value)}
          className="ml-auto block w-16 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-right font-mono text-xs text-stone-100"
        />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap justify-end gap-1">
          {ACTIONS.map(({ type, label, icon: Icon, color }) => (
            <Button
              key={type}
              variant="secondary"
              size="sm"
              disabled={isLogging}
              className="gap-1 px-2"
              onClick={() => onLog(row.sku_id, type, qty)}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className={cn("h-3.5 w-3.5", color)} />
              )}
              {qty > 1 ? `${label} ${qty}` : label}
            </Button>
          ))}
        </div>
      </td>
    </tr>
  );
});
