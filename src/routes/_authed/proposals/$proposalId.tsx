import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle, Loader2, Send, Ship } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useActivateFromProposal,
  useProposal,
  useUpdateProposalStatus,
} from "@/hooks/useProposals";
import { ensureProposalDetail } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/proposals/$proposalId")({
  loader: ({ context: { queryClient }, params: { proposalId } }) =>
    ensureProposalDetail(queryClient, proposalId),
  component: ProposalDetailPage,
});

function ProposalDetailPage() {
  const { proposalId } = Route.useParams();
  const navigate = useNavigate();
  const { data, isPending, error } = useProposal(proposalId);
  const updateStatus = useUpdateProposalStatus();
  const activate = useActivateFromProposal();

  const [showActivate, setShowActivate] = useState(false);
  const [activateForm, setActivateForm] = useState({
    cspo_number: "",
    attendance_type: "in_service" as "in_service" | "in_drydock",
    port_of_service: "",
    planned_start: "",
    planned_end: "",
  });

  if (isInitialQueryLoad(isPending, data)) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading…</div>;
  }

  if (error || !data?.proposal) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-red-400">{(error as Error)?.message ?? "Not found"}</p>
        <Link to="/proposals" className="mt-3 inline-block text-xs text-stone-500 underline">
          Back to proposals
        </Link>
      </div>
    );
  }

  const { proposal: p, lines } = data;
  const vessel = p.vessel as unknown as {
    name: string;
    fleet?: { name: string } | null;
  } | null;

  async function handleActivate(e: FormEvent) {
    e.preventDefault();
    const { id: cspoId } = await activate.mutateAsync({
      proposalId,
      cspo_number: activateForm.cspo_number,
      attendance_type: activateForm.attendance_type,
      port_of_service: activateForm.port_of_service || undefined,
      planned_start: activateForm.planned_start || undefined,
      planned_end: activateForm.planned_end || undefined,
    });
    void navigate({ to: "/cspos/$cspoId", params: { cspoId } });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link
        to="/proposals"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> All proposals
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">{p.proposal_number}</h1>
            <Badge variant={p.status === "approved" ? "on_vessel" : "draft"}>
              {statusLabel(p.status)}
            </Badge>
          </div>
          {vessel && (
            <span className="flex items-center gap-1.5 text-sm text-stone-400">
              <Ship className="h-3.5 w-3.5" />
              {vessel.name}
              {vessel.fleet?.name && (
                <span className="text-stone-600">· {vessel.fleet.name}</span>
              )}
            </span>
          )}
          {p.scope_summary && (
            <p className="max-w-2xl text-sm text-stone-400">{p.scope_summary}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.status === "draft" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={updateStatus.isPending}
              onClick={() => void updateStatus.mutateAsync({ id: proposalId, status: "sent" })}
            >
              <Send className="h-3.5 w-3.5" /> Mark sent
            </Button>
          )}
          {(p.status === "draft" || p.status === "sent") && (
            <Button
              variant="primary"
              size="sm"
              disabled={updateStatus.isPending}
              onClick={() => void updateStatus.mutateAsync({ id: proposalId, status: "approved" })}
            >
              <CheckCircle className="h-3.5 w-3.5" /> Mark approved
            </Button>
          )}
          {p.status === "approved" && (
            <Button variant="primary" size="sm" onClick={() => setShowActivate(true)}>
              Activate CSPO
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4">
        <div className="text-xs text-stone-500">Total value</div>
        <div className="text-2xl font-semibold text-stone-100">
          {formatCurrency(Number(p.total_value), p.currency)}
        </div>
      </Card>

      {showActivate && p.status === "approved" && (
        <Card className="p-4">
          <h2 className="mb-4 text-sm font-medium text-stone-200">Activate CSPO</h2>
          <form onSubmit={(e) => void handleActivate(e)} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <label className="text-xs text-stone-400">Ship PO number *</label>
                <input
                  required
                  placeholder="e.g. 44521"
                  value={activateForm.cspo_number}
                  onChange={(e) =>
                    setActivateForm((f) => ({ ...f, cspo_number: e.target.value }))
                  }
                  className={inputClass}
                />
              </div>
              <div className="col-span-2 flex gap-3">
                {(["in_service", "in_drydock"] as const).map((type) => (
                  <label
                    key={type}
                    className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-stone-700 px-3 py-2 text-sm"
                  >
                    <input
                      type="radio"
                      checked={activateForm.attendance_type === type}
                      onChange={() =>
                        setActivateForm((f) => ({ ...f, attendance_type: type }))
                      }
                    />
                    {type === "in_service" ? "In Service" : "In Drydock"}
                  </label>
                ))}
              </div>
              {activateForm.attendance_type === "in_drydock" && (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <label className="text-xs text-stone-400">Port</label>
                  <input
                    value={activateForm.port_of_service}
                    onChange={(e) =>
                      setActivateForm((f) => ({ ...f, port_of_service: e.target.value }))
                    }
                    className={inputClass}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-stone-400">Planned start</label>
                <input
                  type="date"
                  value={activateForm.planned_start}
                  onChange={(e) =>
                    setActivateForm((f) => ({ ...f, planned_start: e.target.value }))
                  }
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-stone-400">Planned end</label>
                <input
                  type="date"
                  value={activateForm.planned_end}
                  onChange={(e) =>
                    setActivateForm((f) => ({ ...f, planned_end: e.target.value }))
                  }
                  className={inputClass}
                />
              </div>
            </div>
            {activate.error && (
              <p className="text-xs text-red-400">{(activate.error as Error).message}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowActivate(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={activate.isPending}>
                {activate.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Create CSPO"
                )}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
          Line items ({lines.length})
        </h2>
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 text-left text-xs text-stone-500">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium text-right">Qty</th>
                <th className="px-4 py-3 font-medium text-right">Unit</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/60">
              {lines.map((line) => {
                const label = line.sku
                  ? `${line.sku.sku_code} — ${line.sku.name}`
                  : line.custom_description ?? "Custom";
                const total = Number(line.qty) * Number(line.unit_price);
                return (
                  <tr key={line.id}>
                    <td className="px-4 py-3 text-stone-200">{label}</td>
                    <td className="px-4 py-3 text-right font-mono">{line.qty}</td>
                    <td className="px-4 py-3 text-right font-mono text-stone-400">
                      {formatCurrency(Number(line.unit_price), p.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatCurrency(total, p.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
