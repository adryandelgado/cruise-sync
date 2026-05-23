import { Loader2, PackagePlus, Search, Send, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useAddMaterialListItem,
  useMaterialList,
  useRemoveMaterialListItem,
  useSubmitMaterialList,
} from "@/hooks/useMaterialList";
import { useSkuStock } from "@/hooks/useSkus";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import {
  computeMaterialListStats,
  filterMaterialListItems,
  groupMaterialListBySku,
} from "@/lib/materialListStats";
import { cn } from "@/lib/utils";

type Props = {
  cspoId: string;
  cspoStatus: string;
};

export function MaterialListSection({ cspoId, cspoStatus }: Props) {
  const { data: list, isPending } = useMaterialList(cspoId);
  const { data: stock } = useSkuStock();
  const addItem = useAddMaterialListItem();
  const removeItem = useRemoveMaterialListItem();
  const submitList = useSubmitMaterialList();

  const [showAdd, setShowAdd] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [skuSearch, setSkuSearch] = useState("");
  const [skuId, setSkuId] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [qty, setQty] = useState("1");

  const stats = useMemo(
    () => computeMaterialListStats(list?.items ?? []),
    [list?.items],
  );
  const filteredGroups = useMemo(() => {
    const filtered = filterMaterialListItems(list?.items ?? [], search);
    return groupMaterialListBySku(filtered);
  }, [list?.items, search]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const filteredStock = useMemo(() => {
    const q = skuSearch.trim().toUpperCase();
    if (!q) return stock ?? [];
    return (stock ?? []).filter(
      (s) =>
        s.sku_code.toUpperCase().includes(q) ||
        s.name.toUpperCase().includes(q),
    );
  }, [stock, skuSearch]);

  const editable = list?.status === "draft" && cspoStatus !== "closed";
  const supplemental =
    !editable &&
    list != null &&
    list.status !== "draft" &&
    cspoStatus !== "closed" &&
    cspoStatus !== "cancelled" &&
    ["in_progress", "on_vessel", "in_transit", "packing"].includes(cspoStatus);
  const canAddItems = editable || supplemental;
  const canRemoveItems = editable || supplemental;
  const stockBySku = new Map((stock ?? []).map((s) => [s.sku_id, s.on_hand]));

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const parsedQty = parseFloat(qty);
    if (!parsedQty || parsedQty <= 0) return;
    if (supplemental && !skuId) return;

    await addItem.mutateAsync({
      cspoId,
      skuId: skuId || undefined,
      customDescription: customDesc.trim() || undefined,
      requestedQty: parsedQty,
    });

    setSkuId("");
    setCustomDesc("");
    setQty("1");
    setShowAdd(false);
  }

  if (isInitialQueryLoad(isPending, list)) {
    return (
      <Card className="py-12 text-center text-sm text-stone-500">Loading material list…</Card>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Material list
          </h2>
          {list && (
            <Badge variant={list.status === "draft" ? "draft" : "packing"}>
              {statusLabel(list.status)}
            </Badge>
          )}
          {list && list.items.length > 0 && (
            <span className="text-xs text-stone-500">
              {stats.uniqueSkus} SKUs · {stats.totalUnits} units requested
              {stats.totalLines > stats.uniqueSkus && (
                <> ({stats.totalLines} lines)</>
              )}
              {stats.packedUnits > 0 && (
                <> · {stats.packedUnits} packed ({stats.completeLines}/{stats.totalLines} lines done)</>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAddItems && (
            <Button variant="secondary" size="sm" onClick={() => setShowAdd((v) => !v)}>
              <PackagePlus className="h-3.5 w-3.5" />
              {supplemental ? "Add catalog SKU" : "Add items"}
            </Button>
          )}
          {editable && list && list.items.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              disabled={submitList.isPending}
              onClick={() => void submitList.mutateAsync(cspoId)}
            >
              {submitList.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Submit for packing
            </Button>
          )}
        </div>
      </div>

      {supplemental && (
        <Card className="mb-4 border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200/80">
          Custom-only lines do not create trackable inventory aboard. Remove mistaken custom
          lines with the trash icon, add a <strong className="text-amber-100">catalog SKU</strong>,
          pack at warehouse, then receive the new package onboard.
        </Card>
      )}

      {showAdd && canAddItems && (
        <Card className="mb-4 p-4">
          <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-stone-400">Catalog SKU</label>
                <input
                  type="search"
                  placeholder="Search SKU code or name…"
                  value={skuSearch}
                  onChange={(e) => setSkuSearch(e.target.value)}
                  className={inputClass}
                />
                <select
                  value={skuId}
                  onChange={(e) => setSkuId(e.target.value)}
                  className={inputClass}
                  size={Math.min(6, Math.max(3, filteredStock.length + 1))}
                >
                  <option value="">Custom item (not tracked aboard)</option>
                  {filteredStock.map((s) => (
                    <option key={s.sku_id} value={s.sku_id}>
                      {s.sku_code} — {s.name} ({s.on_hand} on hand)
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-stone-400">Qty</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            {!skuId && supplemental && (
              <p className="text-xs text-amber-400">
                Select a catalog SKU — custom items will not unlock daily log or returns.
              </p>
            )}
            {!skuId && !supplemental && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-stone-400">Custom description</label>
                <input
                  required
                  placeholder="e.g. Custom aluminum frame, 48×24 in"
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  className={inputClass}
                />
              </div>
            )}
            {(addItem.error || submitList.error) && (
              <p className="text-xs text-red-400">
                {((addItem.error ?? submitList.error) as Error).message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={addItem.isPending || (supplemental && !skuId)}>
                {addItem.isPending ? "Adding…" : "Add to list"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!list || list.items.length === 0 ? (
        <Card className="py-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm font-medium text-stone-400">No materials yet</p>
            <p className="max-w-xs text-xs text-stone-600">
              Build the material list from your SKU catalog — on-hand counts show inline
              so you can flag stock-outs before warehouse packing starts.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {list.items.length > 8 && (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600" />
              <input
                type="search"
                placeholder="Filter lines by SKU or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={cn(inputClass, "pl-9")}
              />
            </div>
          )}
          <Card className="overflow-hidden">
            <div className="max-h-[min(70vh,640px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-stone-950">
                  <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">On hand</th>
                    <th className="px-4 py-3 font-medium text-right">Requested</th>
                    <th className="px-4 py-3 font-medium text-right">Packed</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    {canRemoveItems && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/60">
                  {filteredGroups.length === 0 && (
                    <tr>
                      <td colSpan={canRemoveItems ? 6 : 5} className="px-4 py-8 text-center text-stone-500">
                        No lines match “{search}”
                      </td>
                    </tr>
                  )}
                  {filteredGroups.flatMap((group) => {
                    const onHand = group.sku_id ? stockBySku.get(group.sku_id) : null;
                    const short =
                      onHand !== null && onHand !== undefined && onHand < group.requested_qty;
                    const expanded = expandedGroups.has(group.key);
                    const unit = group.items[0]?.sku?.unit_of_measure;

                    const mainRow = (
                      <tr key={group.key}>
                        <td className="px-4 py-3 text-stone-200">
                          <div className="flex items-center gap-1.5">
                            {group.line_count > 1 && (
                              <button
                                type="button"
                                onClick={() => toggleGroup(group.key)}
                                className="text-stone-500 hover:text-stone-300"
                                aria-label={expanded ? "Collapse lines" : "Expand lines"}
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <span>
                              {group.label}
                              {group.line_count > 1 && (
                                <span className="ml-2 font-mono text-xs text-brand-400">
                                  {group.line_count} lines
                                </span>
                              )}
                            </span>
                            {!group.sku_id && (
                              <span className="text-xs text-amber-500/80">· not tracked</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {onHand !== null && onHand !== undefined ? (
                            <span className={cn(short && "font-medium text-amber-400")}>
                              {onHand}
                              {short && " ⚠"}
                            </span>
                          ) : (
                            <span className="text-stone-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {group.requested_qty}
                          {unit && <span className="ml-1 text-stone-600">{unit}</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-stone-400">
                          {group.packed_qty}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="draft">{statusLabel(group.status)}</Badge>
                        </td>
                        {canRemoveItems && (
                          <td className="px-4 py-3 text-right">
                            {group.line_count === 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRemoveError(null);
                                  void removeItem
                                    .mutateAsync({ itemId: group.items[0]!.id, cspoId })
                                    .catch((e: Error) => setRemoveError(e.message));
                                }}
                                disabled={removeItem.isPending}
                                className="text-stone-600 hover:text-red-400 disabled:opacity-40"
                                aria-label="Remove item"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );

                    if (!expanded || group.line_count <= 1) return [mainRow];

                    const subRows = group.items.map((item) => (
                      <tr key={item.id} className="bg-stone-950/40">
                        <td className="px-4 py-2 pl-10 text-xs text-stone-500">Line detail</td>
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 text-right font-mono text-xs text-stone-400">
                          {item.requested_qty}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-stone-500">
                          {item.packed_qty}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="draft">{statusLabel(item.status)}</Badge>
                        </td>
                        {canRemoveItems && (
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setRemoveError(null);
                                void removeItem
                                  .mutateAsync({ itemId: item.id, cspoId })
                                  .catch((e: Error) => setRemoveError(e.message));
                              }}
                              disabled={removeItem.isPending}
                              className="text-stone-600 hover:text-red-400 disabled:opacity-40"
                              aria-label="Remove line"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ));

                    return [mainRow, ...subRows];
                  })}
                </tbody>
              </table>
            </div>
            {removeError && (
              <p className="border-t border-stone-800 px-4 py-3 text-xs text-red-400">{removeError}</p>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
