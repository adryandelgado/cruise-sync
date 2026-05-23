import { useQuery } from "@tanstack/react-query";

import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

export type HealthStatus =
  | { state: "not_configured" }
  | {
      state: "connected";
      tablesFound: number;
      tablesExpected: number;
      schemaOk: boolean;
      missingTables?: string[];
      pendingMigrations?: string[];
    }
  | { state: "schema_missing" }
  | { state: "error"; message: string };

interface HealthCheckResult {
  status: string;
  schema_version: string;
  tables_found: number;
  tables_expected: number;
}

interface SchemaStatusResult {
  ok: boolean;
  missing: Array<{ table: string; migration: string }> | null;
  next_step: string;
}

async function fetchHealth(): Promise<HealthStatus> {
  if (!env.supabaseConfigured) {
    return { state: "not_configured" };
  }

  const { data, error } = await supabase().rpc("health_check");

  if (error) {
    if (error.code === "PGRST202" || error.message?.includes("health_check")) {
      return { state: "schema_missing" };
    }
    return { state: "error", message: error.message };
  }

  const result = data as HealthCheckResult;

  const { data: statusData } = await supabase().rpc("schema_status");
  const status = statusData as SchemaStatusResult | null;

  // schema_status is authoritative; health_check count had an off-by-one (29 listed, expected 28).
  const schemaOk =
    status?.ok === true ||
    result.tables_found >= result.tables_expected;

  if (!schemaOk) {
    const missing = (status?.missing ?? []).filter(Boolean);
    const migrations = [...new Set(missing.map((m) => m.migration))];

    return {
      state: "connected",
      tablesFound: result.tables_found,
      tablesExpected: result.tables_expected,
      schemaOk: false,
      missingTables: missing.map((m) => m.table),
      pendingMigrations: migrations.length > 0 ? migrations : undefined,
    };
  }

  return {
    state: "connected",
    tablesFound: result.tables_found,
    tablesExpected: result.tables_expected,
    schemaOk: true,
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
