/** Turn PostgREST / RPC errors into actionable messages for the UI. */
export function formatSupabaseError(error: unknown): string {
  const err = error as { message?: string; code?: string; details?: string };
  const msg = err?.message ?? String(error);

  if (err?.code === "PGRST202" || msg.includes("schema cache")) {
    if (msg.includes("procurement") || msg.includes("create_procurement")) {
      return `${msg} — Run migration 20260521000005_procurement_and_sales.sql in Supabase SQL Editor, then hard-refresh.`;
    }
    return `${msg} — Run pending SQL migrations in Supabase SQL Editor, then hard-refresh.`;
  }

  return msg;
}
