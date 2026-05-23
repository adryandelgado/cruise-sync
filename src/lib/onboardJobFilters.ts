import type { OnboardJob } from "@/lib/onboardHubCache";

export type OnboardJobFilter = "" | "needs_receive" | "has_inventory" | "pending_transfers";

export const ONBOARD_JOB_FILTERS: { id: OnboardJobFilter; label: string }[] = [
  { id: "", label: "All" },
  { id: "needs_receive", label: "Needs receive" },
  { id: "has_inventory", label: "Has inventory" },
  { id: "pending_transfers", label: "Pending transfers" },
];

export function filterOnboardJobs(
  jobs: OnboardJob[],
  search: string,
  filter: OnboardJobFilter,
): OnboardJob[] {
  const q = search.trim().toUpperCase();
  return jobs.filter((job) => {
    if (filter === "needs_receive" && job.pending_receipts === 0) return false;
    if (filter === "has_inventory" && job.items_on_vessel === 0) return false;
    if (filter === "pending_transfers" && job.pending_transfers === 0) return false;
    if (!q) return true;
    const vessel = job.vessel?.name?.toUpperCase() ?? "";
    const fleet = job.vessel?.fleet?.name?.toUpperCase() ?? "";
    return (
      job.cspo_number.toUpperCase().includes(q) ||
      vessel.includes(q) ||
      fleet.includes(q)
    );
  });
}

export function jobSearchPlaceholder() {
  return "Search PO #, vessel, fleet…";
}
