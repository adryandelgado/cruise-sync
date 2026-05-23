import type { PackJobRow } from "@/hooks/usePackJobs";

export function filterPackJobs(
  jobs: PackJobRow[],
  search: string,
  attendanceFilter: "" | "in_service" | "in_drydock",
): PackJobRow[] {
  const q = search.trim().toUpperCase();
  return jobs.filter((job) => {
    if (attendanceFilter && job.attendance_type !== attendanceFilter) return false;
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
