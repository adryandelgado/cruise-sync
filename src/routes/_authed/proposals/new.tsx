import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateProposal } from "@/hooks/useProposals";
import { useSkus } from "@/hooks/useSkus";
import { useVessels } from "@/hooks/useVessels";
import { ensureFormPickers } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { cn, formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/proposals/new")({
  loader: ({ context: { queryClient } }) => ensureFormPickers(queryClient),
  component: NewProposalPage,
});

type LineDraft = {
  key: string;
  sku_id: string;
  custom_description: string;
  qty: string;
  unit_price: string;
};

function emptyLine(): LineDraft {
  return {
    key: crypto.randomUUID(),
    sku_id: "",
    custom_description: "",
    qty: "1",
    unit_price: "",
  };
}

function NewProposalPage() {
  const navigate = useNavigate();
  const { data: vessels, isPending } = useVessels();
  const loadingVessels = isInitialQueryLoad(isPending, vessels);
  const { data: skus } = useSkus();
  const createProposal = useCreateProposal();

  const [form, setForm] = useState({
    proposal_number: "",
    vessel_id: "",
    scope_summary: "",
    currency: "USD",
  });
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  function setField(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function onSkuChange(key: string, skuId: string) {
    const sku = skus?.find((s) => s.id === skuId);
    updateLine(key, {
      sku_id: skuId,
      custom_description: "",
      unit_price: sku?.default_cost != null ? String(sku.default_cost) : "",
    });
  }

  const lineTotal = lines.reduce((sum, l) => {
    const qty = parseFloat(l.qty) || 0;
    const price = parseFloat(l.unit_price) || 0;
    return sum + qty * price;
  }, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const parsedLines = lines
      .filter((l) => l.sku_id || l.custom_description.trim())
      .map((l) => ({
        sku_id: l.sku_id || undefined,
        custom_description: l.custom_description.trim() || undefined,
        qty: parseFloat(l.qty) || 1,
        unit_price: parseFloat(l.unit_price) || 0,
      }));

    const created = await createProposal.mutateAsync({
      proposal_number: form.proposal_number,
      vessel_id: form.vessel_id,
      scope_summary: form.scope_summary,
      currency: form.currency,
      lines: parsedLines,
    });

    void navigate({ to: "/proposals/$proposalId", params: { proposalId: created.listRow.id } });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => void navigate({ to: "/proposals" })}
        className="mb-6 flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to proposals
      </button>

      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New proposal</h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
        <Card>
          <CardHeader><CardTitle>Header</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Proposal # <span className="text-red-400">*</span></Label>
              <Input
                placeholder="e.g. PROP-2026-042"
                value={form.proposal_number}
                onChange={(e) => setField("proposal_number", e.target.value)}
                required
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Vessel <span className="text-red-400">*</span></Label>
              <select
                required
                value={form.vessel_id}
                onChange={(e) => setField("vessel_id", e.target.value)}
                className={inputClass}
              >
                <option value="">
                  {loadingVessels ? "Loading vessels…" : "Select a vessel"}
                </option>
                {(vessels ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.fleet ? ` — ${v.fleet.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Scope summary</Label>
              <textarea
                rows={3}
                placeholder="Brief description of work scope…"
                value={form.scope_summary}
                onChange={(e) => setField("scope_summary", e.target.value)}
                className={cn(inputClass, "resize-none")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Line items</CardTitle>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((l) => [...l, emptyLine()])}
            >
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {lines.map((line) => (
              <div
                key={line.key}
                className="grid grid-cols-12 gap-2 rounded-md border border-stone-800 p-3"
              >
                <div className="col-span-12 sm:col-span-5 flex flex-col gap-1">
                  <span className="text-xs text-stone-500">SKU</span>
                  <select
                    value={line.sku_id}
                    onChange={(e) => onSkuChange(line.key, e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Custom item</option>
                    {(skus ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sku_code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                {!line.sku_id && (
                  <div className="col-span-12 sm:col-span-4 flex flex-col gap-1">
                    <span className="text-xs text-stone-500">Description</span>
                    <Input
                      placeholder="Custom item description"
                      value={line.custom_description}
                      onChange={(e) =>
                        updateLine(line.key, { custom_description: e.target.value })
                      }
                      required={!line.sku_id}
                    />
                  </div>
                )}
                <div className="col-span-4 sm:col-span-2 flex flex-col gap-1">
                  <span className="text-xs text-stone-500">Qty</span>
                  <Input
                    type="number"
                    min="0.01"
                    step="any"
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                    required
                  />
                </div>
                <div className="col-span-4 sm:col-span-2 flex flex-col gap-1">
                  <span className="text-xs text-stone-500">Unit $</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unit_price}
                    onChange={(e) =>
                      updateLine(line.key, { unit_price: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="col-span-4 sm:col-span-1 flex items-end justify-end">
                  <button
                    type="button"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((prev) => prev.filter((l) => l.key !== line.key))
                    }
                    className="mb-2 text-stone-600 hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}

            <div className="flex justify-end text-sm text-stone-400">
              Total:{" "}
              <span className="ml-2 font-mono font-medium text-stone-200">
                {formatCurrency(lineTotal, form.currency)}
              </span>
            </div>
          </CardContent>
        </Card>

        {createProposal.error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {(createProposal.error as Error).message}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigate({ to: "/proposals" })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={createProposal.isPending}>
            {createProposal.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              "Create proposal"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-stone-300">{children}</label>;
}
