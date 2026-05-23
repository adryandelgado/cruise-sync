import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Package, PackageCheck, Ship } from "lucide-react";
import { useMemo, useState } from "react";
import { JobListToolbar } from "@/components/shared/JobListToolbar";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PackJobRow } from "@/hooks/usePackJobs";
import { useWarehouseHub } from "@/hooks/usePackJobs";
import { filterPackJobs } from "@/lib/packJobFilters";
import { prefetchPackSession, prefetchPackingDocs, prefetchReturnRestockJobs, ensureWarehouseHubPage } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";

export const Route = createFileRoute("/_authed/warehouse/")({
  loader: ({ context: { queryClient } }) => ensureWarehouseHubPage(queryClient),
  component: WarehousePage,
});

function WarehousePage() {
  const qc = useQueryClient();
  const { data: hub, isPending, error } = useWarehouseHub();
  const isLoading = isInitialQueryLoad(isPending, hub);
  const packJobs = hub?.packJobs ?? [];
  const activeSource = useMemo(
    () => packJobs.filter((job) => job.material_list && job.material_list.remaining_units > 0),
    [packJobs],
  );
  const readySource = useMemo(
    () => packJobs.filter((job) => job.material_list?.is_fully_packed),
    [packJobs],
  );
  const [search, setSearch] = useState("");
  const [attendanceFilter, setAttendanceFilter] = useState<"" | "in_service" | "in_drydock">("");

  const activeJobs = useMemo(
    () => filterPackJobs(activeSource, search, attendanceFilter),
    [activeSource, search, attendanceFilter],
  );
  const readyJobs = useMemo(
    () => filterPackJobs(readySource, search, attendanceFilter),
    [readySource, search, attendanceFilter],
  );
  const totalJobs = activeSource.length + readySource.length;
  const filteredCount = activeJobs.length + readyJobs.length;
  const hasJobs = totalJobs > 0;
  const hasFilteredJobs = filteredCount > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My Jobs</h1>
        <p className="text-sm text-stone-400">
          Pack jobs awaiting warehouse pick. Tap to start packing.
        </p>
        <Link
          to="/warehouse/restock"
          onMouseEnter={() => prefetchReturnRestockJobs(qc)}
          className="mt-3 inline-flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300"
        >
          <PackageCheck className="h-4 w-4" />
          Return restock queue
          {hub && hub.restock.pendingUnits > 0 && (
            <Badge variant="packing">{hub.restock.pendingUnits} pending</Badge>
          )}
          <span aria-hidden>→</span>
        </Link>
      </header>

      {isLoading && (
        <div className="py-16 text-center text-sm text-stone-500">Loading jobs…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!isLoading && !error && !hasJobs && (
        <Card className="py-16">
          <div className="flex flex-col items-center gap-3 text-center">
            <Package className="h-10 w-10 text-stone-700" />
            <p className="font-medium text-stone-300">No active pack jobs</p>
            <p className="max-w-sm text-sm text-stone-500">
              When a PM submits a material list for packing, it appears here
              for warehouse operators.
            </p>
          </div>
        </Card>
      )}

      {!isLoading && !error && hasJobs && (
        <>
          <JobListToolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search PO #, vessel, fleet…"
            filters={[
              { id: "", label: "All" },
              { id: "in_service", label: "In service" },
              { id: "in_drydock", label: "In drydock" },
            ]}
            activeFilter={attendanceFilter}
            onFilter={(id) => setAttendanceFilter(id as typeof attendanceFilter)}
            count={filteredCount}
            total={totalJobs}
          />
          {!hasFilteredJobs && (
            <Card className="py-12 text-center text-sm text-stone-500">
              No jobs match your filters
            </Card>
          )}
        </>
      )}

      {activeJobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Needs packing ({activeJobs.length})
          </h2>
          {activeJobs.map((job) => (
            <PackJobCard key={job.cspo_id} job={job} action="pack" />
          ))}
        </section>
      )}

      {readyJobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Ready to finish & ship ({readyJobs.length})
          </h2>
          <p className="text-xs text-stone-500">
            All units are on pallets — enter dimensions and generate shipping docs.
          </p>
          {readyJobs.map((job) => (
            <PackJobCard key={job.cspo_id} job={job} action="finish" />
          ))}
        </section>
      )}
    </div>
  );
}

function PackJobCard({
  job,
  action,
}: {
  job: PackJobRow;
  action: "pack" | "finish";
}) {
  const qc = useQueryClient();
  const list = job.material_list;
  const due = job.planned_end
    ? new Date(job.planned_end).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  const progress = list
    ? action === "finish"
      ? `${list.packed_units} / ${list.total_units} units · all lines complete`
      : `${list.packed_units} / ${list.total_units} units · ${list.packed_count} / ${list.item_count} lines`
    : "—";

  return (
    <Card
      className="p-5"
      onMouseEnter={() => {
        prefetchPackSession(qc, job.cspo_id);
        if (action === "finish") prefetchPackingDocs(qc, job.cspo_id);
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Ship className="h-4 w-4 text-stone-500" />
              <span className="font-medium text-stone-100">
                {job.vessel?.name ?? "Unknown vessel"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-brand-400">{job.cspo_number}</span>
              <Badge
                variant={
                  job.attendance_type === "in_service" ? "in_service" : "in_drydock"
                }
              >
                {job.attendance_type === "in_service" ? "In Service" : "In Drydock"}
              </Badge>
              <Badge variant={action === "finish" ? "on_vessel" : "packing"}>
                {action === "finish"
                  ? "Ready to ship"
                  : statusLabel(list?.status ?? "submitted")}
              </Badge>
            </div>
          </div>
          {due && <span className="text-xs text-stone-500">Due {due}</span>}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-stone-400">{progress}</span>
          <Link
            to="/warehouse/pack/$cspoId"
            params={{ cspoId: job.cspo_id }}
            onMouseEnter={() => prefetchPackSession(qc, job.cspo_id)}
          >
            <Button size="lg">{action === "finish" ? "Finish & ship" : "Start packing"}</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
