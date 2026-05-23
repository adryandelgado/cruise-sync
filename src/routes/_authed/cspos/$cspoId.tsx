import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Calendar, Loader2, MapPin, Ship } from "lucide-react";
import { MaterialListSection } from "@/components/cspo/MaterialListSection";
import { ClosureSection } from "@/components/cspo/ClosureSection";
import { CspoWorkflowSection } from "@/components/cspo/CspoWorkflowSection";
import { FinancialSummaryCards } from "@/components/cspo/FinancialSummaryCards";
import { ValueLedgerSection } from "@/components/cspo/ValueLedgerSection";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActivateCspo, useCspoDetailSession } from "@/hooks/useCspos";
import { ensureCspoDetailPage } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";

export const Route = createFileRoute("/_authed/cspos/$cspoId")({
  loader: ({ context: { queryClient }, params: { cspoId } }) =>
    ensureCspoDetailPage(queryClient, cspoId),
  component: CspoDetailPage,
});

function CspoDetailPage() {
  const { cspoId } = Route.useParams();
  const navigate = useNavigate();
  const { data: session, isPending, error } = useCspoDetailSession(cspoId);
  const activateCspo = useActivateCspo();

  if (isInitialQueryLoad(isPending, session)) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading…</div>;
  }

  if (error || !session) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-red-400">{(error as Error)?.message ?? "CSPO not found"}</p>
        <button
          onClick={() => void navigate({ to: "/cspos" })}
          className="mt-3 text-xs text-stone-500 underline"
        >
          Back to list
        </button>
      </div>
    );
  }

  const c = session.cspo;
  const s = session.financial.summary;
  const workflow = session.workflow;
  const aboardPhase = ["in_transit", "on_vessel", "in_progress", "closing"].includes(c.status);

  const unitsAboard = aboardPhase ? workflow.units_aboard : s.items_on_vessel;
  const skusAboard = aboardPhase ? workflow.sku_count_aboard : 0;
  const aboardLabel =
    aboardPhase && skusAboard > 0
      ? `${skusAboard} SKUs · ${unitsAboard} units`
      : String(unitsAboard);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Back */}
      <Link
        to="/cspos"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> All CSPOs
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">
              {c.cspo_number}
            </h1>
            <Badge variant={c.status as Parameters<typeof Badge>[0]["variant"]}>
              {statusLabel(c.status)}
            </Badge>
            <Badge
              variant={
                c.attendance_type === "in_service" ? "in_service" : "in_drydock"
              }
            >
              {c.attendance_type === "in_service" ? "In Service" : "In Drydock"}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-stone-400">
            {c.vessel && (
              <span className="flex items-center gap-1.5">
                <Ship className="h-3.5 w-3.5" />
                {c.vessel.name}
                {c.vessel.fleet?.name && (
                  <span className="text-stone-600">· {c.vessel.fleet.name}</span>
                )}
              </span>
            )}
            {(c.planned_start || c.planned_end) && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {c.planned_start
                  ? new Date(c.planned_start).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—"}
                {c.planned_end &&
                  ` → ${new Date(c.planned_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
              </span>
            )}
            {c.port_of_service && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {c.port_of_service}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {c.status === "draft" && (
            <Button
              variant="primary"
              size="sm"
              disabled={activateCspo.isPending}
              onClick={() => void activateCspo.mutateAsync(cspoId)}
            >
              {activateCspo.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Activate CSPO
            </Button>
          )}
          {c.status === "in_transit" && (
            <Link to="/onboard/receive/$cspoId" params={{ cspoId: c.id }}>
              <Button variant="primary" size="sm">Receive aboard</Button>
            </Link>
          )}
          {(c.status === "in_progress" || c.status === "on_vessel") && (
            <>
              <Link to="/onboard/log/$cspoId" params={{ cspoId: c.id }}>
                <Button variant="secondary" size="sm">Daily log</Button>
              </Link>
              <Link to="/onboard/returns/$cspoId" params={{ cspoId: c.id }}>
                <Button variant="secondary" size="sm">Returns / transfer</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <CspoWorkflowSection
        cspoId={c.id}
        cspoStatus={c.status}
        summary={workflow}
      />

      {/* Financial spine */}
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
          Financial summary
        </h2>
        <FinancialSummaryCards
          currency={c.currency}
          originalValue={Number(c.original_value)}
          summary={s}
          aboardLabel={aboardLabel}
          loading={false}
        />
        {s && !s.has_initial_ledger && Number(c.original_value) > 0 && (
          <p className="mt-2 text-xs text-amber-400">
            Missing initial ledger entry — run migration 018 or the open balance may not match
            original PO value until backfilled.
          </p>
        )}
      </section>

      <ValueLedgerSection
        currency={c.currency}
        entries={session.financial.entries}
        isLoading={false}
        defaultCollapsed={session.financial.entries.length > 25}
      />

      {/* Material list */}
      <MaterialListSection cspoId={c.id} cspoStatus={c.status} />

      {/* Closure */}
      <ClosureSection
        cspoId={c.id}
        cspoStatus={c.status}
        summary={s}
      />
    </div>
  );
}
