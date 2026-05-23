import type { CspoRow } from "@/hooks/useCspos";

export const CSPO_STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "active", label: "Active" },
  { id: "packing", label: "Packing" },
  { id: "in_transit", label: "In transit" },
  { id: "on_vessel", label: "On vessel" },
  { id: "in_progress", label: "In progress" },
  { id: "closed", label: "Closed" },
] as const;

export function filterCspos(
  cspos: CspoRow[],
  query: string,
  statusFilter: string,
): CspoRow[] {
  const q = query.trim().toUpperCase();
  return cspos.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (!q) return true;
    const vessel = c.vessel?.name?.toUpperCase() ?? "";
    const fleet = c.vessel?.fleet?.name?.toUpperCase() ?? "";
    return (
      c.cspo_number.toUpperCase().includes(q) ||
      vessel.includes(q) ||
      fleet.includes(q)
    );
  });
}

export function cspoQuickAction(
  c: CspoRow,
): { label: string; to: "/warehouse/pack/$cspoId" | "/onboard/receive/$cspoId" | "/onboard/log/$cspoId"; cspoId: string } | null {
  if (c.status === "packing") {
    return { label: "Pack", to: "/warehouse/pack/$cspoId", cspoId: c.id };
  }
  if (c.status === "in_transit") {
    return { label: "Receive", to: "/onboard/receive/$cspoId", cspoId: c.id };
  }
  if (c.status === "on_vessel" || c.status === "in_progress") {
    return { label: "Log", to: "/onboard/log/$cspoId", cspoId: c.id };
  }
  return null;
}
