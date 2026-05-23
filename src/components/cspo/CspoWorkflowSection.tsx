import { useCspoWorkflowSummary, type CspoWorkflowSummary } from "@/hooks/useClosure";
import { CspoWorkflowBanner } from "./CspoWorkflowBanner";

type Props = {
  cspoId: string;
  cspoStatus: string;
  summary?: CspoWorkflowSummary;
};

export function CspoWorkflowSection({ cspoId, cspoStatus, summary }: Props) {
  const active =
    cspoStatus !== "closed" && cspoStatus !== "cancelled" && cspoStatus !== "draft";

  const { data: fetchedSummary } = useCspoWorkflowSummary(cspoId, active && !summary);
  const resolved = summary ?? fetchedSummary;

  return (
    <CspoWorkflowBanner
      cspoId={cspoId}
      cspoStatus={cspoStatus}
      listStatus={resolved?.list_status ?? null}
      listItemCount={resolved?.list_item_count ?? 0}
      unitsAboard={resolved?.units_aboard ?? 0}
      skuCountAboard={resolved?.sku_count_aboard ?? 0}
      pendingReceipts={resolved?.pending_receipts ?? 0}
      totalPackages={resolved?.total_packages ?? 0}
      blockingUnits={resolved?.blocker_count ?? 0}
      pendingOutboundTransfers={resolved?.pending_outbound_transfers ?? 0}
    />
  );
}
