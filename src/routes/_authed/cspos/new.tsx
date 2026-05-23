import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateCspo } from "@/hooks/useCspos";
import { useVessels } from "@/hooks/useVessels";
import { ensureVessels } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/cspos/new")({
  loader: ({ context: { queryClient } }) => ensureVessels(queryClient),
  component: NewCspoPage,
});

function NewCspoPage() {
  const navigate = useNavigate();
  const { data: vessels, isPending } = useVessels();
  const loadingVessels = isInitialQueryLoad(isPending, vessels);
  const createCspo = useCreateCspo();

  const [form, setForm] = useState({
    cspo_number: "",
    vessel_id: "",
    attendance_type: "in_service" as "in_service" | "in_drydock",
    port_of_service: "",
    planned_start: "",
    planned_end: "",
    original_value: "",
    currency: "USD",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { id } = await createCspo.mutateAsync({
      cspo_number: form.cspo_number.trim(),
      vessel_id: form.vessel_id,
      attendance_type: form.attendance_type,
      port_of_service: form.port_of_service.trim() || undefined,
      planned_start: form.planned_start || undefined,
      planned_end: form.planned_end || undefined,
      original_value: parseFloat(form.original_value) || 0,
      currency: form.currency,
    });
    void navigate({ to: "/cspos/$cspoId", params: { cspoId: id } });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={() => void navigate({ to: "/cspos" })}
        className="mb-6 flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to CSPOs
      </button>

      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New CSPO</h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-5">
        <Card>
          <CardHeader><CardTitle>PO Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>PO Number <span className="text-red-400">*</span></Label>
              <Input
                placeholder="e.g. 44521"
                value={form.cspo_number}
                onChange={(e) => set("cspo_number", e.target.value)}
                required
              />
              <p className="text-xs text-stone-500">
                The purchase order number issued by the ship.
              </p>
            </div>

            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Vessel <span className="text-red-400">*</span></Label>
              <select
                required
                value={form.vessel_id}
                onChange={(e) => set("vessel_id", e.target.value)}
                className={inputClass}
              >
                <option value="">
                  {loadingVessels ? "Loading vessels…" : "Select a vessel"}
                </option>
                {(vessels ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.fleet ? ` — ${v.fleet.name}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-2 flex flex-col gap-2">
              <Label>Attendance type <span className="text-red-400">*</span></Label>
              <div className="flex gap-3">
                {(["in_service", "in_drydock"] as const).map((type) => (
                  <label
                    key={type}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center gap-2.5 rounded-md border px-4 py-3 text-sm transition-colors",
                      form.attendance_type === type
                        ? "border-brand-600 bg-brand-950/30 text-stone-100"
                        : "border-stone-700 text-stone-400 hover:border-stone-600",
                    )}
                  >
                    <input
                      type="radio"
                      name="attendance_type"
                      value={type}
                      checked={form.attendance_type === type}
                      onChange={() => set("attendance_type", type)}
                      className="accent-brand-500"
                    />
                    {type === "in_service" ? "In Service" : "In Drydock"}
                  </label>
                ))}
              </div>
            </div>

            {form.attendance_type === "in_drydock" && (
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>Port / Drydock location</Label>
                <Input
                  placeholder="e.g. Brest, France"
                  value={form.port_of_service}
                  onChange={(e) => set("port_of_service", e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Schedule</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Planned start</Label>
              <Input
                type="date"
                value={form.planned_start}
                onChange={(e) => set("planned_start", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Planned end</Label>
              <Input
                type="date"
                value={form.planned_end}
                onChange={(e) => set("planned_end", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Value</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Original value <span className="text-red-400">*</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.original_value}
                onChange={(e) => set("original_value", e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Currency</Label>
              <select
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
                className={inputClass}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {createCspo.error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {(createCspo.error as Error).message}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigate({ to: "/cspos" })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={createCspo.isPending}>
            {createCspo.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
            ) : (
              "Create CSPO"
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
