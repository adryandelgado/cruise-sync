import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  ClipboardList,
  FileText,
  Package,
  PackageCheck,
  Ship,
} from "lucide-react";
import { useMemo, useState } from "react";
import { JobListToolbar } from "@/components/shared/JobListToolbar";
import { Badge, statusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { canWorkAboard, useOnboardHub, type OnboardJob } from "@/hooks/useOnboard";
import {
  filterOnboardJobs,
  jobSearchPlaceholder,
  ONBOARD_JOB_FILTERS,
  type OnboardJobFilter,
} from "@/lib/onboardJobFilters";
import { prefetchOnboardHub, prefetchOnboardJobCard, prefetchOnboardSession, prefetchPackSession, ensureOnboardHub } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";

export const Route = createFileRoute("/_authed/onboard/")({
  loader: ({ context: { queryClient } }) => ensureOnboardHub(queryClient),
  component: OnboardPage,
});

function HintBanner({ job }: { job: OnboardJob }) {
  if (job.next_step === "ready" || job.next_step === null) return null;

  const hints: Record<
    Exclude<OnboardJob["next_step"], "ready" | null>,
    { title: string; body: string }
  > = {
    pack: {
      title: "Not shipped yet",
      body: "Pack catalog SKUs at the warehouse and complete packing before receive.",
    },
    receive: {
      title: "Packages to receive",
      body: `${job.pending_receipts} of ${job.total_packages} package(s) still need to be scanned aboard.`,
    },
    receive_empty: {
      title: "Last shipment had no trackable items",
      body: "Custom-only packages don't count as inventory. Add catalog SKUs and ship another package, or continue work aboard if none needed.",
    },
    working_empty: {
      title: "Work aboard — no trackable inventory yet",
      body: "You can close the CSPO or use daily log once SKU items are received. Add catalog SKUs on CSPO detail if you need tracked materials.",
    },
  };

  const hint = hints[job.next_step];

  return (
    <div className="mb-4 rounded-md border border-stone-800 bg-stone-900/50 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-stone-300">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        {hint.title}
      </p>
      <p className="mt-1 text-xs text-stone-500">{hint.body}</p>
    </div>
  );
}

function OnboardPage() {
  const qc = useQueryClient();
  const { data: hub, isPending, error } = useOnboardHub();
  const loading = isInitialQueryLoad(isPending, hub);
  const jobs = hub?.jobs ?? [];
  const summary = hub?.summary;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<OnboardJobFilter>("");

  const filtered = useMemo(
    () => filterOnboardJobs(jobs ?? [], search, filter),
    [jobs, search, filter],
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Onboard</h1>
        <p className="text-sm text-stone-400">
          Receive freight, log usage, process returns, and close CSPOs.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link
            to="/onboard/log"
            onMouseEnter={() => prefetchOnboardHub(qc)}
            className="inline-flex items-center gap-2 text-brand-400 hover:underline"
          >
            Daily log
            {summary && summary.loggable > 0 && (
              <Badge variant="in_progress">{summary.loggable}</Badge>
            )}
          </Link>
          <Link
            to="/onboard/returns"
            onMouseEnter={() => prefetchOnboardHub(qc)}
            className="inline-flex items-center gap-2 text-brand-400 hover:underline"
          >
            Returns / transfers
            {summary && summary.pendingTransfers > 0 && (
              <Badge variant="packing">{summary.pendingTransfers} ack</Badge>
            )}
          </Link>
        </div>
      </header>

      {loading && (
        <div className="py-16 text-center text-sm text-stone-500">Loading…</div>
      )}

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!loading && !error && summary && summary.needsReceive > 0 && (
        <p className="text-xs text-stone-500">
          {summary.needsReceive} job{summary.needsReceive === 1 ? "" : "s"} awaiting package receive
        </p>
      )}

      {!loading && !error && jobs.length === 0 && (
        <Card className="py-16 text-center">
          <Ship className="mx-auto mb-3 h-10 w-10 text-stone-700" />
          <p className="font-medium text-stone-300">No active onboard jobs</p>
          <p className="mt-1 text-sm text-stone-500">
            CSPOs appear here once freight ships or work starts aboard.
          </p>
        </Card>
      )}

      {!loading && !error && jobs.length > 0 && (
        <JobListToolbar
          search={search}
          onSearch={setSearch}
          placeholder={jobSearchPlaceholder()}
          filters={ONBOARD_JOB_FILTERS}
          activeFilter={filter}
          onFilter={(id) => setFilter(id as OnboardJobFilter)}
          count={filtered.length}
          total={jobs.length}
        />
      )}

      {!loading && !error && jobs && jobs.length > 0 && filtered.length === 0 && (
        <Card className="py-12 text-center text-sm text-stone-500">
          No jobs match your filters
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((job) => {
          const vessel = job.vessel;
          const working = canWorkAboard(job.status);
          const showOps = working || job.items_on_vessel > 0;

          return (
            <Card
              key={job.cspo_id}
              className="p-5"
              onMouseEnter={() => prefetchOnboardJobCard(qc, job)}
            >
              <HintBanner job={job} />

              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-100">
                      {vessel?.name ?? "Unknown vessel"}
                    </span>
                    <Badge variant={job.status as Parameters<typeof Badge>[0]["variant"]}>
                      {statusLabel(job.status)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 font-mono text-sm text-brand-400">
                    {job.cspo_number}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {job.items_on_vessel} units aboard
                    {job.total_packages > 0 && (
                      <span>
                        {" "}
                        · {job.total_packages - job.pending_receipts}/{job.total_packages}{" "}
                        packages received
                      </span>
                    )}
                    {job.pending_transfers > 0 && (
                      <span className="ml-2 text-violet-400">
                        · {job.pending_transfers} transfer(s) awaiting ack
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {job.pending_receipts > 0 && (
                  <Link
                    to="/onboard/receive/$cspoId"
                    params={{ cspoId: job.cspo_id }}
                    onMouseEnter={() =>
                      prefetchOnboardSession(qc, job.cspo_id, "receive")
                    }
                  >
                    <Button size="sm">
                      <PackageCheck className="h-3.5 w-3.5" />
                      Receive ({job.pending_receipts}/{job.total_packages})
                    </Button>
                  </Link>
                )}

                {showOps && (
                  <>
                    <Link
                      to="/onboard/log/$cspoId"
                      params={{ cspoId: job.cspo_id }}
                      onMouseEnter={() =>
                        prefetchOnboardSession(qc, job.cspo_id, "log")
                      }
                    >
                      <Button variant="secondary" size="sm">
                        <ClipboardList className="h-3.5 w-3.5" />
                        Daily log
                      </Button>
                    </Link>
                    <Link
                      to="/onboard/returns/$cspoId"
                      params={{ cspoId: job.cspo_id }}
                      onMouseEnter={() =>
                        prefetchOnboardSession(qc, job.cspo_id, "returns")
                      }
                    >
                      <Button variant="secondary" size="sm">
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        Returns / transfer
                      </Button>
                    </Link>
                    <Link
                      to="/cspos/$cspoId"
                      params={{ cspoId: job.cspo_id }}
                      onMouseEnter={() =>
                        prefetchOnboardSession(qc, job.cspo_id, "detail")
                      }
                    >
                      <Button variant="ghost" size="sm">
                        <FileText className="h-3.5 w-3.5" />
                        CSPO & close
                      </Button>
                    </Link>
                  </>
                )}

                {!showOps && job.next_step === "pack" && (
                  <Link
                    to="/warehouse/pack/$cspoId"
                    params={{ cspoId: job.cspo_id }}
                    onMouseEnter={() => prefetchPackSession(qc, job.cspo_id)}
                  >
                    <Button size="sm">
                      <Package className="h-3.5 w-3.5" />
                      Warehouse packing
                    </Button>
                  </Link>
                )}

                {!showOps && job.next_step === "receive_empty" && (
                  <>
                    <Link
                      to="/cspos/$cspoId"
                      params={{ cspoId: job.cspo_id }}
                      onMouseEnter={() =>
                        prefetchOnboardSession(qc, job.cspo_id, "detail")
                      }
                    >
                      <Button size="sm">Add catalog SKU</Button>
                    </Link>
                    <Link
                      to="/warehouse/pack/$cspoId"
                      params={{ cspoId: job.cspo_id }}
                      onMouseEnter={() => prefetchPackSession(qc, job.cspo_id)}
                    >
                      <Button variant="secondary" size="sm">
                        <Package className="h-3.5 w-3.5" /> Warehouse
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
