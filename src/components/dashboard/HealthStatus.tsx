import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  XCircle,
} from "lucide-react";

import { useSupabaseHealth } from "@/hooks/useSupabaseHealth";
import { cn } from "@/lib/utils";

export function HealthStatus() {
  const { data, isLoading } = useSupabaseHealth();

  if (isLoading) {
    return (
      <StatusRow variant="neutral">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking Supabase connection…
      </StatusRow>
    );
  }

  if (!data || data.state === "not_configured") {
    return (
      <StatusRow variant="warn">
        <Info className="h-3.5 w-3.5" />
        Supabase not configured — fill in{" "}
        <code className="mx-0.5 rounded bg-amber-900/40 px-1 font-mono text-xs">
          .env.local
        </code>{" "}
        and restart <code className="font-mono">npm run dev</code>.
      </StatusRow>
    );
  }

  if (data.state === "error") {
    return (
      <StatusRow variant="error">
        <XCircle className="h-3.5 w-3.5" />
        Supabase error: {data.message}
      </StatusRow>
    );
  }

  if (data.state === "schema_missing") {
    return (
      <StatusRow variant="warn">
        <AlertTriangle className="h-3.5 w-3.5" />
        Supabase reachable but schema not applied — run the three SQL files from{" "}
        <code className="mx-0.5 font-mono text-xs">supabase/migrations/</code>{" "}
        in the dashboard SQL editor.
      </StatusRow>
    );
  }

  if (data.state === "connected" && !data.schemaOk) {
    return (
      <StatusRow variant="warn">
        <AlertTriangle className="h-3.5 w-3.5" />
        Supabase connected — schema partially applied ({data.tablesFound}/
        {data.tablesExpected} tables found). Re-run the migrations.
      </StatusRow>
    );
  }

  return (
    <StatusRow variant="ok">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Supabase connected · {data.tablesFound}/{data.tablesExpected} tables
      present
    </StatusRow>
  );
}

const variantClasses = {
  ok: "bg-emerald-950/40 border-emerald-900/60 text-emerald-200",
  warn: "bg-amber-950/40 border-amber-900/60 text-amber-200",
  error: "bg-red-950/40 border-red-900/60 text-red-200",
  neutral: "bg-stone-900/60 border-stone-800 text-stone-400",
} as const;

function StatusRow({
  variant,
  children,
}: {
  variant: keyof typeof variantClasses;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
        variantClasses[variant],
      )}
    >
      {children}
    </div>
  );
}
