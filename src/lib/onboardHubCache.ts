import type { QueryClient } from "@tanstack/react-query";

export const ONBOARD_HUB_QUERY_KEY = ["onboard-hub"] as const;

/** CSPO is in the aboard work phase (daily log, returns, closure). */
export function canWorkAboard(status: string) {
  return status === "on_vessel" || status === "in_progress";
}

export type OnboardJob = {
  cspo_id: string;
  cspo_number: string;
  status: string;
  attendance_type: string;
  vessel: { name: string; fleet: { name: string } | null } | null;
  pending_receipts: number;
  total_packages: number;
  items_on_vessel: number;
  pending_transfers: number;
  next_step:
    | "pack"
    | "receive"
    | "receive_empty"
    | "working_empty"
    | "ready"
    | null;
};

export type OnboardHubSummary = {
  jobCount: number;
  needsReceive: number;
  loggable: number;
  pendingTransfers: number;
};

export type OnboardHub = {
  jobs: OnboardJob[];
  summary: OnboardHubSummary;
};

type OnboardJobRpcRow = {
  cspo_id: string;
  cspo_number: string;
  status: string;
  attendance_type: string;
  vessel: OnboardJob["vessel"];
  total_packages: number;
  received_packages: number;
  items_on_vessel: number;
  pending_transfers: number;
};

export type OnboardHubRpc = {
  jobs: OnboardJobRpcRow[];
};

export function computeNextStep(
  status: string,
  itemsOnVessel: number,
  pendingReceipts: number,
  totalPackages: number,
): OnboardJob["next_step"] {
  if (pendingReceipts > 0) return "receive";

  if (canWorkAboard(status)) {
    return itemsOnVessel > 0 ? "ready" : "working_empty";
  }

  if (status === "in_transit") {
    if (totalPackages === 0) return "pack";
    if (itemsOnVessel === 0) return "receive_empty";
    return "ready";
  }

  if (itemsOnVessel > 0) return "ready";
  if (totalPackages > 0) return "receive_empty";
  return "pack";
}

export function mapOnboardJobsFromRpc(rows: OnboardJobRpcRow[]): OnboardJob[] {
  return rows.map((row) => {
    const pendingReceipts = Math.max(0, row.total_packages - row.received_packages);
    return {
      cspo_id: row.cspo_id,
      cspo_number: row.cspo_number,
      status: row.status,
      attendance_type: row.attendance_type,
      vessel: row.vessel,
      pending_receipts: pendingReceipts,
      total_packages: row.total_packages,
      items_on_vessel: row.items_on_vessel,
      pending_transfers: row.pending_transfers,
      next_step: computeNextStep(
        row.status,
        row.items_on_vessel,
        pendingReceipts,
        row.total_packages,
      ),
    };
  });
}

export function computeOnboardSummary(jobs: OnboardJob[]): OnboardHubSummary {
  return {
    jobCount: jobs.length,
    needsReceive: jobs.filter((job) => job.pending_receipts > 0).length,
    loggable: jobs.filter((job) => canWorkAboard(job.status)).length,
    pendingTransfers: jobs.reduce((sum, job) => sum + job.pending_transfers, 0),
  };
}

export function mapOnboardHubFromRpc(payload: OnboardHubRpc): OnboardHub {
  const jobs = mapOnboardJobsFromRpc(payload.jobs ?? []);
  return { jobs, summary: computeOnboardSummary(jobs) };
}

function withSummary(jobs: OnboardJob[]): OnboardHub {
  return { jobs, summary: computeOnboardSummary(jobs) };
}

function updateOnboardJob(
  qc: QueryClient,
  cspoId: string,
  patch: Partial<OnboardJob>,
) {
  qc.setQueryData<OnboardHub>(ONBOARD_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    const jobs = old.jobs.map((job) => {
      if (job.cspo_id !== cspoId) return job;
      const next = { ...job, ...patch };
      return {
        ...next,
        next_step: computeNextStep(
          next.status,
          next.items_on_vessel,
          next.pending_receipts,
          next.total_packages,
        ),
      };
    });
    return withSummary(jobs);
  });
}

export function patchOnboardHubAfterReceive(
  qc: QueryClient,
  cspoId: string,
  session: {
    cspo: { status: string };
    packages: Array<{ received: boolean }>;
    items_on_vessel: number;
  },
) {
  const pendingReceipts = session.packages.filter((pkg) => !pkg.received).length;
  updateOnboardJob(qc, cspoId, {
    status: session.cspo.status,
    pending_receipts: pendingReceipts,
    total_packages: session.packages.length,
    items_on_vessel: session.items_on_vessel,
  });
}

export function patchOnboardHubJobFields(
  qc: QueryClient,
  cspoId: string,
  patch: Partial<OnboardJob>,
) {
  updateOnboardJob(qc, cspoId, patch);
}

export function patchOnboardHubRemoveJob(qc: QueryClient, cspoId: string) {
  qc.setQueryData<OnboardHub>(ONBOARD_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    const jobs = old.jobs.filter((job) => job.cspo_id !== cspoId);
    return withSummary(jobs);
  });
}

export function patchOnboardHubPendingTransferDelta(
  qc: QueryClient,
  cspoId: string,
  delta: number,
) {
  qc.setQueryData<OnboardHub>(ONBOARD_HUB_QUERY_KEY, (old) => {
    if (!old) return old;
    const jobs = old.jobs.map((job) => {
      if (job.cspo_id !== cspoId) return job;
      return {
        ...job,
        pending_transfers: Math.max(0, job.pending_transfers + delta),
      };
    });
    return withSummary(jobs);
  });
}

export function patchOnboardHubInventoryTotals(
  qc: QueryClient,
  cspoId: string,
  itemsOnVessel: number,
  status?: string,
) {
  updateOnboardJob(qc, cspoId, {
    ...(status ? { status } : {}),
    items_on_vessel: itemsOnVessel,
  });
}
