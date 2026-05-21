import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Calendar, MapPin, Ship } from "lucide-react";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCspo } from "@/hooks/useCspos";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/_authed/cspos/$cspoId")({
  component: CspoDetailPage,
});

function CspoDetailPage() {
  const { cspoId } = Route.useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useCspo(cspoId);

  if (isLoading) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading…</div>;
  }

  if (error || !data?.detail) {
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

  const { detail: c, summary: s } = data;
  const vessel = c.vessel as unknown as { name: string; fleet?: { name: string } | null } | null;

  const valueCards = [
    {
      label: "Original value",
      value: formatCurrency(Number(c.original_value), c.currency),
      sub: "As-issued PO amount",
      color: "text-stone-100",
    },
    {
      label: "Open balance",
      value: s ? formatCurrency(Number(s.open_balance), c.currency) : "—",
      sub: "Remaining unreconciled",
      color: "text-emerald-300",
    },
    {
      label: "Consumed / installed",
      value: s
        ? formatCurrency(
            Number(s.consumed_value ?? 0) + Number(s.installed_value ?? 0),
            c.currency,
          )
        : "—",
      sub: "Written off against this PO",
      color: "text-amber-300",
    },
    {
      label: "Returned",
      value: s ? formatCurrency(Number(s.returned_value ?? 0), c.currency) : "—",
      sub: "Value back in warehouse",
      color: "text-sky-300",
    },
    {
      label: "Transferred out",
      value: s ? formatCurrency(Number(s.transferred_out_value ?? 0), c.currency) : "—",
      sub: "Moved to another CSPO",
      color: "text-violet-300",
    },
    {
      label: "Items on vessel",
      value: s ? String(s.items_on_vessel ?? 0) : "—",
      sub: "Material instances aboard",
      color: "text-stone-100",
    },
  ];

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
            {vessel && (
              <span className="flex items-center gap-1.5">
                <Ship className="h-3.5 w-3.5" />
                {vessel.name}
                {vessel.fleet?.name && (
                  <span className="text-stone-600">· {vessel.fleet.name}</span>
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

        <div className="flex items-center gap-2">
          {c.status === "draft" && (
            <Button variant="primary" size="sm">
              Activate CSPO
            </Button>
          )}
        </div>
      </div>

      {/* Financial spine */}
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-500">
          Financial summary
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {valueCards.map(({ label, value, sub, color }) => (
            <Card key={label} className="flex flex-col gap-1 p-4">
              <span className="text-xs text-stone-500">{label}</span>
              <span className={`text-xl font-semibold tracking-tight ${color}`}>
                {value}
              </span>
              <span className="text-xs text-stone-600">{sub}</span>
            </Card>
          ))}
        </div>
      </section>

      {/* Material list placeholder */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Material list
          </h2>
          <Button variant="secondary" size="sm" disabled>
            + Add items
          </Button>
        </div>
        <Card className="py-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm font-medium text-stone-400">No materials yet</p>
            <p className="max-w-xs text-xs text-stone-600">
              Activate the CSPO and build the material list — items will appear
              here and drive the warehouse pack flow.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}
