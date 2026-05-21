import { type Session, type User } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";

export interface Profile {
  id: string;
  org_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  active: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  loading: true,
});

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase()
    .from("profiles")
    .select("id, org_id, email, full_name, phone, role, active")
    .eq("id", userId)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!env.supabaseConfigured) {
      setLoading(false);
      return;
    }

    // Hydrate from existing session (e.g. page refresh).
    supabase()
      .auth.getSession()
      .then(async ({ data: { session: s } }) => {
        setSession(s);
        if (s?.user) setProfile(await fetchProfile(s.user.id));
        setLoading(false);
      });

    const { data: listener } = supabase().auth.onAuthStateChange(
      async (event, s) => {
        setSession(s);
        if (s?.user) {
          setProfile(await fetchProfile(s.user.id));
        } else {
          setProfile(null);
        }
        if (event === "INITIAL_SESSION") setLoading(false);
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
