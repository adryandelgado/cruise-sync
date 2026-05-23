import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { useMemo, useState } from "react";
import { JobListToolbar } from "@/components/shared/JobListToolbar";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useOnboardJobs, canWorkAboard } from "@/hooks/useOnboard";
import {
  filterOnboardJobs,
  jobSearchPlaceholder,
  ONBOARD_JOB_FILTERS,
  type OnboardJobFilter,
} from "@/lib/onboardJobFilters";
import { prefetchUsageLogSession, ensureOnboardHub } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";

export const Route = createFileRoute("/_authed/onboard/log/")({
  loader: ({ context: { queryClient } }) => ensureOnboardHub(queryClient),
  component: OnboardLogIndexPage,
});

function OnboardLogIndexPage() {
  const qc = useQueryClient();
  const { data: jobs, isPending } = useOnboardJobs();
  const loading = isInitialQueryLoad(isPending, jobs);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<OnboardJobFilter>("");

  const loggable = useMemo(
    () => (jobs ?? []).filter((j) => canWorkAboard(j.status)),
    [jobs],
  );
  const filtered = useMemo(
    () => filterOnboardJobs(loggable, search, filter),
    [loggable, search, filter],
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        to="/onboard"
        className="flex w-fit items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
      >
        <ArrowLeft className="h-4 w-4" /> Onboard
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Daily usage log</h1>
        <p className="text-sm text-stone-400">
          Pick a CSPO in the aboard work phase. Inventory logging requires catalog SKUs received
          aboard.
        </p>
      </header>

      {loading && (
        <div className="py-12 text-center text-sm text-stone-500">Loading…</div>
      )}

      {!loading && loggable.length === 0 && (
        <Card className="p-6 text-sm text-stone-400">
          <p className="font-medium text-stone-200">No CSPOs in the aboard work phase yet.</p>
          <p className="mt-2">
            Receive packages aboard first — CSPOs move to <strong className="text-stone-300">In progress</strong> or{" "}
            <strong className="text-stone-300">On vessel</strong> automatically.
          </p>
        </Card>
      )}

      {!loading && loggable.length > 0 && (
        <JobListToolbar
          search={search}
          onSearch={setSearch}
          placeholder={jobSearchPlaceholder()}
          filters={ONBOARD_JOB_FILTERS.filter((f) => f.id !== "needs_receive")}
          activeFilter={filter}
          onFilter={(id) => setFilter(id as OnboardJobFilter)}
          count={filtered.length}
          total={loggable.length}
        />
      )}

      {!loading && loggable.length > 0 && filtered.length === 0 && (
        <Card className="py-12 text-center text-sm text-stone-500">
          No CSPOs match your filters
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((job) => (
          <Card
            key={job.cspo_id}
            className="flex items-center justify-between p-4"
            onMouseEnter={() => prefetchUsageLogSession(qc, job.cspo_id)}
          >
            <div>
              <p className="font-medium text-stone-100">{job.vessel?.name ?? "Vessel"}</p>
              <p className="font-mono text-sm text-brand-400">{job.cspo_number}</p>
              <p className="text-xs text-stone-500">{job.items_on_vessel} units aboard</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={job.status as Parameters<typeof Badge>[0]["variant"]}>
                {statusLabel(job.status)}
              </Badge>
              <Link
                to="/onboard/log/$cspoId"
                params={{ cspoId: job.cspo_id }}
                onMouseEnter={() => prefetchUsageLogSession(qc, job.cspo_id)}
              >
                <Button size="sm">
                  <ClipboardList className="h-3.5 w-3.5" /> Open log
                </Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
