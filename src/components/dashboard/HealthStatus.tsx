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
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            Supabase reachable but base schema not applied.
          </span>
          <span className="ml-5 font-mono text-[11px]">
            Run migrations 001 → 002 → 003 in SQL Editor first.
          </span>
        </div>
      </StatusRow>
    );
  }

  if (data.state === "connected" && !data.schemaOk) {
    return (
      <StatusRow variant="warn">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Schema incomplete ({data.tablesFound}/{data.tablesExpected} tables).
            See the amber banner at the top — paste each migration in Supabase SQL Editor.
          </span>
          {(data.pendingMigrations ?? []).length > 0 && (
            <ul className="ml-5 list-disc font-mono text-[11px]">
              {data.pendingMigrations!.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
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
