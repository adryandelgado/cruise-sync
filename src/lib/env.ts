function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  /** True only when both Supabase env vars are present. */
  get supabaseConfigured(): boolean {
    return Boolean(
      import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
    );
  },
  requireSupabase(): { url: string; anonKey: string } {
    return {
      url: required("VITE_SUPABASE_URL"),
      anonKey: required("VITE_SUPABASE_ANON_KEY"),
    };
  },
};
