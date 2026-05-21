import { useQuery } from "@tanstack/react-query";

import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

export type HealthStatus =
  | { state: "not_configured" }
  | { state: "connected"; tablesFound: number; tablesExpected: number; schemaOk: boolean }
  | { state: "schema_missing" }
  | { state: "error"; message: string };

interface HealthCheckResult {
  status: string;
  schema_version: string;
  tables_found: number;
  tables_expected: number;
}

async function fetchHealth(): Promise<HealthStatus> {
  if (!env.supabaseConfigured) {
    return { state: "not_configured" };
  }

  const { data, error } = await supabase().rpc("health_check");

  if (error) {
    if (error.code === "PGRST202" || error.message?.includes("health_check")) {
      // Function doesn't exist — schema not applied yet.
      return { state: "schema_missing" };
    }
    return { state: "error", message: error.message };
  }

  const result = data as HealthCheckResult;
  return {
    state: "connected",
    tablesFound: result.tables_found,
    tablesExpected: result.tables_expected,
    schemaOk: result.tables_found === result.tables_expected,
  };
}

export function useSupabaseHealth() {
  return useQuery({
    queryKey: ["supabase-health"],
    queryFn: fetchHealth,
    staleTime: 60_000,
    retry: 1,
  });
}
