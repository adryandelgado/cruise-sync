import type { Query, QueryClient } from "@tanstack/react-query";
import { LIVE_PATCHED_STALE_MS } from "@/lib/queryStaleTimes";

const STORAGE_KEY = "shipsync-query-cache-v1";
const PERSIST_DEBOUNCE_MS = 750;
const MAX_PERSISTED_QUERIES = 96;

type PersistedPayload = {
  savedAt: number;
  queries: Array<{
    queryKey: unknown[];
    data: unknown;
    dataUpdatedAt: number;
  }>;
};

const SKIP_ROOTS = new Set([
  "supabase-health",
  "analytics-health",
  "material-search",
  "material-trace",
]);

function shouldPersistQuery(query: Query): boolean {
  if (query.state.data === undefined) return false;
  const root = query.queryKey[0];
  if (typeof root !== "string") return false;
  if (SKIP_ROOTS.has(root)) return false;
  return true;
}

function readPayload(): PersistedPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPayload;
    if (!parsed?.queries?.length) return null;
    if (Date.now() - parsed.savedAt > LIVE_PATCHED_STALE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/** Restore whitelisted queries from the last session (same tab). */
export function hydrateQueryCache(qc: QueryClient) {
  const payload = readPayload();
  if (!payload) return;

  for (const entry of payload.queries) {
    qc.setQueryData(entry.queryKey, entry.data);
    const cached = qc.getQueryCache().find({ queryKey: entry.queryKey });
    if (cached) {
      cached.setState({
        ...cached.state,
        data: entry.data,
        dataUpdatedAt: entry.dataUpdatedAt,
      });
    }
  }
}

/** Debounced write of in-memory query data to sessionStorage. */
export function attachQueryCachePersist(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const persist = () => {
    const queries = qc
      .getQueryCache()
      .getAll()
      .filter(shouldPersistQuery)
      .sort(
        (a, b) =>
          (b.state.dataUpdatedAt ?? 0) - (a.state.dataUpdatedAt ?? 0),
      )
      .slice(0, MAX_PERSISTED_QUERIES)
      .map((query) => ({
        queryKey: query.queryKey as unknown[],
        data: query.state.data,
        dataUpdatedAt: query.state.dataUpdatedAt ?? Date.now(),
      }));

    if (queries.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }

    const payload: PersistedPayload = {
      savedAt: Date.now(),
      queries,
    };

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  };

  qc.getQueryCache().subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(persist, PERSIST_DEBOUNCE_MS);
  });

  window.addEventListener("pagehide", persist);
}
