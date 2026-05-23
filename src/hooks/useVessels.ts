import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { REFERENCE_STALE_MS } from "@/lib/queryStaleTimes";

export type VesselRow = {
  id: string;
  name: string;
  fleet: { id: string; name: string } | null;
};

export async function fetchVessels(): Promise<VesselRow[]> {
  const { data, error } = await supabase()
    .from("vessels")
    .select("id, name, fleet:fleets(id, name)")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data as unknown as VesselRow[];
}

export function useVessels() {
  return useQuery({
    queryKey: ["vessels"],
    queryFn: fetchVessels,
    staleTime: REFERENCE_STALE_MS,
  });
}
