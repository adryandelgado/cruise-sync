import { AlertTriangle } from "lucide-react";

import { env } from "@/lib/env";

export function EnvBanner() {
  if (env.supabaseConfigured) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-900/60 bg-amber-950/40 px-6 py-2 text-xs text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>
        Supabase env vars are not set. Fill in{" "}
        <code className="rounded bg-amber-900/40 px-1 py-0.5 font-mono">
          .env.local
        </code>{" "}
        with <code className="font-mono">VITE_SUPABASE_URL</code> and{" "}
        <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>, then restart{" "}
        <code className="font-mono">npm run dev</code>.
      </span>
    </div>
  );
}
