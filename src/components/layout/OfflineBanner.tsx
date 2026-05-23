import { AlertTriangle, Loader2, WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  describeOfflineMutation,
  discardFailedOfflineMutation,
  getOfflineQueueFailure,
  getOfflineQueueLength,
  isOfflineQueueFlushing,
  retryOfflineMutationQueue,
  subscribeOfflineQueue,
} from "@/lib/offlineMutationQueue";
import { queryClient } from "@/lib/queryClient";

function subscribeOnline(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function readFailure() {
  return getOfflineQueueFailure();
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => true);
  const pending = useSyncExternalStore(
    subscribeOfflineQueue,
    getOfflineQueueLength,
    () => 0,
  );
  const flushing = useSyncExternalStore(
    subscribeOfflineQueue,
    isOfflineQueueFlushing,
    () => false,
  );
  const failure = useSyncExternalStore(subscribeOfflineQueue, readFailure, () => null);

  if (online && pending === 0) return null;

  if (!online) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-sm text-amber-200"
      >
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          You&apos;re offline. Cached data is still available
          {pending > 0
            ? ` — ${pending} change${pending === 1 ? "" : "s"} queued to sync.`
            : "; new changes won't sync until you're back online."}
        </span>
      </div>
    );
  }

  if (failure && !flushing) {
    const label = describeOfflineMutation(failure.entry);
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-red-900/50 bg-red-950/40 px-4 py-2 text-sm text-red-200"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          Sync failed on <span className="font-medium">{label}</span>
          {pending > 1 ? ` (${pending} queued)` : ""}: {failure.message}
        </span>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => retryOfflineMutationQueue(queryClient)}
          >
            Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-300 hover:text-red-100"
            onClick={() => discardFailedOfflineMutation()}
          >
            Skip
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-sky-900/50 bg-sky-950/40 px-4 py-2 text-sm text-sky-200"
    >
      {flushing ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : (
        <WifiOff className="h-4 w-4 shrink-0 opacity-0" aria-hidden />
      )}
      <span className="flex-1">
        {flushing
          ? `Syncing ${pending} queued change${pending === 1 ? "" : "s"}…`
          : `${pending} queued change${pending === 1 ? "" : "s"} waiting to sync.`}
      </span>
      {!flushing && pending > 0 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => retryOfflineMutationQueue(queryClient)}
        >
          Sync now
        </Button>
      )}
    </div>
  );
}
