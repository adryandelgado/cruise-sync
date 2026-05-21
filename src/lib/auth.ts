import { supabase } from "@/lib/supabase";

export async function signInWithMagicLink(email: string, redirectTo: string) {
  return supabase().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  });
}

export async function signOut() {
  return supabase().auth.signOut();
}
