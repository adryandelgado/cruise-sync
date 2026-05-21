import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useVessels() {
  return useQuery({
    queryKey: ["vessels"],
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("vessels")
        .select("id, name, fleet:fleets(id, name)")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as unknown as Array<{
        id: string;
        name: string;
        fleet: { id: string; name: string } | null;
      }>;
    },
  });
}
