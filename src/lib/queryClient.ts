import { QueryClient, onlineManager } from "@tanstack/react-query";
import {
  attachQueryCachePersist,
  hydrateQueryCache,
} from "@/lib/queryCachePersist";
import { attachOfflineMutationQueue } from "@/lib/offlineMutationQueue";
import { LIVE_PATCHED_STALE_MS } from "@/lib/queryStaleTimes";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: LIVE_PATCHED_STALE_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

onlineManager.setEventListener((setOnline) => {
  const sync = () => setOnline(navigator.onLine);
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
  return () => {
    window.removeEventListener("online", sync);
    window.removeEventListener("offline", sync);
  };
});

hydrateQueryCache(queryClient);
attachQueryCachePersist(queryClient);
attachOfflineMutationQueue(queryClient);
