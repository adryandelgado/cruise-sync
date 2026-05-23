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

export async function signInWithPassword(email: string, password: string) {
  return supabase().auth.signInWithPassword({ email, password });
}

export async function requestPasswordReset(email: string, redirectTo: string) {
  return supabase().auth.resetPasswordForEmail(email, {
    redirectTo,
  });
}

export async function updatePassword(password: string) {
  return supabase().auth.updateUser({ password });
}

export async function signOut() {
  return supabase().auth.signOut();
}
