import type { QueryClient } from "@tanstack/react-query";
import type { ReturnManifestRow } from "@/hooks/useOnboard";
import {
  executeAcknowledgeTransferRpc,
  executeAddReturnSkuQtyRpc,
  executeCreateReturnManifestRpc,
  executeInitiateTransferSkuQtyRpc,
  executeReceivePackageRpc,
  executeSealReturnManifestRpc,
  reconcileAcknowledgeTransferReplay,
  reconcileAddReturnSkuQtyReplay,
  reconcileCreateReturnManifestReplay,
  reconcileInitiateTransferSkuQtyReplay,
  reconcileReceivePackageReplay,
  reconcileSealReturnManifestReplay,
  type AcknowledgeTransferVars,
  type AddReturnSkuQtyVars,
  type CreateReturnManifestVars,
  type InitiateTransferSkuQtyVars,
  type ReceivePackageVars,
  type SealReturnManifestVars,
} from "@/lib/onboardOfflineMutations";
import {
  executeLogSkuUsageRpc,
  reconcileLogSkuUsageReplay,
  type LogSkuUsageVars,
} from "@/lib/usageLogMutation";
import {
  executeCompleteReturnReceiptRpc,
  executeReceiveReturnSkuQtyRpc,
  reconcileCompleteReturnReceiptReplay,
  reconcileReceiveReturnSkuQtyReplay,
  type CompleteReturnReceiptVars,
  type ReceiveReturnSkuQtyVars,
} from "@/lib/restockOfflineMutations";
import {
  executeCloseCspoRpc,
  reconcileCloseCspoReplay,
  type CloseCspoVars,
} from "@/lib/closureOfflineMutations";
import {
  executeReceiveProcurementRpc,
  reconcileReceiveProcurementReplay,
  type ReceiveProcurementVars,
} from "@/lib/procurementOfflineMutations";
import {
  executePackItemRpc,
  executeSignPodRpc,
  executeCompletePackingRpc,
  executeCreatePackageRpc,
  reconcilePackItemReplay,
  reconcileSignPodReplay,
  reconcileCompletePackingReplay,
  reconcileCreatePackageReplay,
  type PackItemVars,
  type SignPodVars,
  type CompletePackingVars,
  type CreatePackageVars,
} from "@/lib/warehouseOfflineMutations";

const STORAGE_KEY = "shipsync-offline-mutations-v1";

export type OfflineMutationType =
  | "log-sku-usage"
  | "receive-package"
  | "add-return-sku-qty"
  | "initiate-transfer-sku-qty"
  | "create-return-manifest"
  | "seal-return-manifest"
  | "acknowledge-transfer"
  | "receive-return-sku-qty"
  | "complete-return-receipt"
  | "close-cspo"
  | "receive-procurement"
  | "pack-list-item"
  | "sign-pod"
  | "complete-packing"
  | "create-package";

type QueuedMutationBase = {
  id: string;
  createdAt: number;
  lastError?: string;
  lastErrorAt?: number;
};

export type QueuedLogSkuUsageMutation = QueuedMutationBase & {
  type: "log-sku-usage";
  payload: LogSkuUsageVars;
  optimisticLogId?: string;
};

export type QueuedReceivePackageMutation = QueuedMutationBase & {
  type: "receive-package";
  payload: ReceivePackageVars;
};

export type QueuedAddReturnSkuQtyMutation = QueuedMutationBase & {
  type: "add-return-sku-qty";
  payload: AddReturnSkuQtyVars;
};

export type QueuedInitiateTransferSkuQtyMutation = QueuedMutationBase & {
  type: "initiate-transfer-sku-qty";
  payload: InitiateTransferSkuQtyVars;
};

export type QueuedCreateReturnManifestMutation = QueuedMutationBase & {
  type: "create-return-manifest";
  payload: CreateReturnManifestVars;
  optimisticManifestId: string;
};

export type QueuedSealReturnManifestMutation = QueuedMutationBase & {
  type: "seal-return-manifest";
  payload: SealReturnManifestVars;
  manifestItemsSnapshot?: ReturnManifestRow["items"];
  restockManifestId?: string;
};

export type QueuedAcknowledgeTransferMutation = QueuedMutationBase & {
  type: "acknowledge-transfer";
  payload: AcknowledgeTransferVars;
};

export type QueuedReceiveReturnSkuQtyMutation = QueuedMutationBase & {
  type: "receive-return-sku-qty";
  payload: ReceiveReturnSkuQtyVars;
};

export type QueuedCompleteReturnReceiptMutation = QueuedMutationBase & {
  type: "complete-return-receipt";
  payload: CompleteReturnReceiptVars;
};

export type QueuedCloseCspoMutation = QueuedMutationBase & {
  type: "close-cspo";
  payload: CloseCspoVars;
};

export type QueuedReceiveProcurementMutation = QueuedMutationBase & {
  type: "receive-procurement";
  payload: ReceiveProcurementVars;
};

export type QueuedPackListItemMutation = QueuedMutationBase & {
  type: "pack-list-item";
  payload: PackItemVars;
};

export type QueuedSignPodMutation = QueuedMutationBase & {
  type: "sign-pod";
  payload: SignPodVars;
};

export type QueuedCompletePackingMutation = QueuedMutationBase & {
  type: "complete-packing";
  payload: CompletePackingVars;
};

export type QueuedCreatePackageMutation = QueuedMutationBase & {
  type: "create-package";
  payload: CreatePackageVars;
  optimisticPackageId: string;
};

export type QueuedMutation =
  | QueuedLogSkuUsageMutation
  | QueuedReceivePackageMutation
  | QueuedAddReturnSkuQtyMutation
  | QueuedInitiateTransferSkuQtyMutation
  | QueuedCreateReturnManifestMutation
  | QueuedSealReturnManifestMutation
  | QueuedAcknowledgeTransferMutation
  | QueuedReceiveReturnSkuQtyMutation
  | QueuedCompleteReturnReceiptMutation
  | QueuedCloseCspoMutation
  | QueuedReceiveProcurementMutation
  | QueuedPackListItemMutation
  | QueuedSignPodMutation
  | QueuedCompletePackingMutation
  | QueuedCreatePackageMutation;

type QueueListener = () => void;

let flushing = false;
const listeners = new Set<QueueListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function readQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function writeQueue(queue: QueuedMutation[]) {
  if (queue.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  }
  notifyListeners();
}

function remapManifestIdInQueue(fromId: string, toId: string) {
  if (fromId === toId) return;

  const queue = readQueue();
  let changed = false;
  const updated = queue.map((entry) => {
    if (entry.type === "add-return-sku-qty" && entry.payload.manifestId === fromId) {
      changed = true;
      return { ...entry, payload: { ...entry.payload, manifestId: toId } };
    }
    if (entry.type === "seal-return-manifest") {
      let next: QueuedSealReturnManifestMutation = entry;
      if (entry.payload.manifestId === fromId) {
        changed = true;
        next = { ...next, payload: { ...entry.payload, manifestId: toId } };
      }
      if (entry.restockManifestId === fromId) {
        changed = true;
        next = { ...next, restockManifestId: toId };
      }
      return next;
    }
    return entry;
  });

  if (changed) writeQueue(updated);
}

function remapPackageIdInQueue(fromId: string, toId: string) {
  if (fromId === toId) return;

  const queue = readQueue();
  let changed = false;
  const updated = queue.map((entry) => {
    if (entry.type === "pack-list-item" && entry.payload.packageId === fromId) {
      changed = true;
      return { ...entry, payload: { ...entry.payload, packageId: toId } };
    }
    return entry;
  });

  if (changed) writeQueue(updated);
}

export function getOfflineQueueLength() {
  return readQueue().length;
}

export function isOfflineQueueFlushing() {
  return flushing;
}

export function subscribeOfflineQueue(listener: QueueListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueueOfflineMutation(entry: QueuedMutation) {
  writeQueue([...readQueue(), entry]);
}

export function describeOfflineMutation(entry: QueuedMutation): string {
  switch (entry.type) {
    case "log-sku-usage":
      return "Usage log";
    case "receive-package":
      return "Receive package";
    case "add-return-sku-qty":
      return "Return manifest item";
    case "initiate-transfer-sku-qty":
      return "Transfer";
    case "create-return-manifest":
      return "Return manifest";
    case "seal-return-manifest":
      return "Seal return manifest";
    case "acknowledge-transfer":
      return "Acknowledge transfer";
    case "receive-return-sku-qty":
      return "Restock receive";
    case "complete-return-receipt":
      return "Complete restock";
    case "close-cspo":
      return "Close CSPO";
    case "receive-procurement":
      return "Procurement receive";
    case "pack-list-item":
      return "Pack item";
    case "sign-pod":
      return "Sign POD";
    case "complete-packing":
      return "Complete packing";
    case "create-package":
      return "Create package";
    default:
      return "Change";
  }
}

function formatReplayError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Sync failed";
}

export function getOfflineQueueFailure(): { entry: QueuedMutation; message: string } | null {
  const front = readQueue()[0];
  if (!front?.lastError) return null;
  return { entry: front, message: front.lastError };
}

export function retryOfflineMutationQueue(qc: QueryClient) {
  const queue = readQueue();
  if (queue.length === 0) return;

  const updated: QueuedMutation[] = [
    { ...queue[0], lastError: undefined, lastErrorAt: undefined },
    ...queue.slice(1),
  ];
  writeQueue(updated);
  void flushOfflineMutationQueue(qc);
}

export function discardFailedOfflineMutation() {
  const queue = readQueue();
  if (queue.length === 0) return;
  writeQueue(queue.slice(1));
}

async function replayMutation(qc: QueryClient, entry: QueuedMutation) {
  switch (entry.type) {
    case "log-sku-usage": {
      const { result } = await executeLogSkuUsageRpc(entry.payload);
      reconcileLogSkuUsageReplay(qc, entry.payload, result, entry.optimisticLogId);
      return;
    }
    case "receive-package": {
      const data = await executeReceivePackageRpc(entry.payload);
      reconcileReceivePackageReplay(qc, data);
      return;
    }
    case "add-return-sku-qty": {
      const data = await executeAddReturnSkuQtyRpc(entry.payload);
      reconcileAddReturnSkuQtyReplay(qc, entry.payload, data.result);
      return;
    }
    case "initiate-transfer-sku-qty": {
      const data = await executeInitiateTransferSkuQtyRpc(entry.payload);
      reconcileInitiateTransferSkuQtyReplay(qc, data);
      return;
    }
    case "create-return-manifest": {
      const manifestId = await executeCreateReturnManifestRpc(entry.payload.cspoId);
      reconcileCreateReturnManifestReplay(
        qc,
        entry.payload.cspoId,
        entry.optimisticManifestId,
        manifestId,
        remapManifestIdInQueue,
      );
      return;
    }
    case "seal-return-manifest": {
      const data = await executeSealReturnManifestRpc(entry.payload);
      reconcileSealReturnManifestReplay(
        qc,
        entry.payload,
        data,
        entry.manifestItemsSnapshot,
        entry.restockManifestId,
      );
      return;
    }
    case "acknowledge-transfer": {
      const data = await executeAcknowledgeTransferRpc(entry.payload.transferId);
      reconcileAcknowledgeTransferReplay(qc, data);
      return;
    }
    case "receive-return-sku-qty": {
      const data = await executeReceiveReturnSkuQtyRpc(entry.payload);
      reconcileReceiveReturnSkuQtyReplay(qc, entry.payload, data.result);
      return;
    }
    case "complete-return-receipt": {
      await executeCompleteReturnReceiptRpc(entry.payload.manifestId);
      reconcileCompleteReturnReceiptReplay(qc, entry.payload.manifestId);
      return;
    }
    case "close-cspo": {
      const data = await executeCloseCspoRpc(entry.payload);
      reconcileCloseCspoReplay(qc, data);
      return;
    }
    case "receive-procurement": {
      const data = await executeReceiveProcurementRpc(entry.payload);
      reconcileReceiveProcurementReplay(qc, entry.payload, data);
      return;
    }
    case "pack-list-item": {
      const data = await executePackItemRpc(entry.payload);
      reconcilePackItemReplay(qc, entry.payload, data);
      return;
    }
    case "sign-pod": {
      const data = await executeSignPodRpc(entry.payload);
      reconcileSignPodReplay(qc, data);
      return;
    }
    case "complete-packing": {
      const data = await executeCompletePackingRpc(entry.payload.cspoId);
      reconcileCompletePackingReplay(qc, data);
      return;
    }
    case "create-package": {
      const data = await executeCreatePackageRpc(entry.payload);
      reconcileCreatePackageReplay(
        qc,
        entry.payload,
        entry.optimisticPackageId,
        data,
        remapPackageIdInQueue,
      );
      return;
    }
    default:
      throw new Error(`Unknown offline mutation type: ${String((entry as QueuedMutation).type)}`);
  }
}

export async function flushOfflineMutationQueue(qc: QueryClient) {
  if (!navigator.onLine || flushing) return;

  flushing = true;
  notifyListeners();

  try {
    while (navigator.onLine) {
      const queue = readQueue();
      const next = queue[0];
      if (!next) break;

      try {
        await replayMutation(qc, next);
        writeQueue(queue.slice(1));
      } catch (err) {
        const message = formatReplayError(err);
        writeQueue(
          queue.map((item, index) =>
            index === 0
              ? { ...item, lastError: message, lastErrorAt: Date.now() }
              : item,
          ),
        );
        break;
      }
    }
  } finally {
    flushing = false;
    notifyListeners();
  }
}

export function attachOfflineMutationQueue(qc: QueryClient) {
  const flush = () => {
    void flushOfflineMutationQueue(qc);
  };

  window.addEventListener("online", flush);
  if (navigator.onLine && getOfflineQueueLength() > 0) {
    flush();
  }
}
