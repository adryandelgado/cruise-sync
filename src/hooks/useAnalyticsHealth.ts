import { useQuery } from "@tanstack/react-query";

import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

/** Probes analytics views from migration 008 (not counted in table health check). */
export function useAnalyticsHealth() {
  return useQuery({
    queryKey: ["analytics-health"],
    queryFn: async () => {
      if (!env.supabaseConfigured) return { ready: true as const };

      const { error } = await supabase()
        .from("vessel_lifetime_spend")
        .select("vessel_id")
        .limit(1);

      if (error) {
        if (
          error.code === "PGRST205" ||
          error.code === "42P01" ||
          error.message?.includes("vessel_lifetime_spend")
        ) {
          return { ready: false as const };
        }
        throw error;
      }

      return { ready: true as const };
    },
    staleTime: 120_000,
    retry: 1,
  });
}
