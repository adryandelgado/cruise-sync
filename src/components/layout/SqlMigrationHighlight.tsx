import { AlertTriangle, Database, ExternalLink } from "lucide-react";

import { migrationPath } from "@/lib/migrations";

type Props = {
  title?: string;
  subtitle: string;
  files: Array<{ file: string; label: string }>;
  footer?: string;
  variant?: "critical" | "optional";
};

/**
 * Reusable amber callout for “paste this SQL in Supabase” steps.
 */
export function SqlMigrationHighlight({
  title = "Action required — paste SQL in Supabase",
  subtitle,
  files,
  footer,
  variant = "critical",
}: Props) {
  const isCritical = variant === "critical";

  return (
    <div
      role="alert"
      className={
        isCritical
          ? "border-b-2 border-amber-500 bg-gradient-to-r from-amber-950 via-amber-900/90 to-amber-950 px-6 py-4 text-amber-50 shadow-lg shadow-amber-950/50"
          : "border-b border-sky-600/60 bg-gradient-to-r from-sky-950/90 via-sky-900/70 to-sky-950/90 px-6 py-3 text-sky-50"
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        <div className="flex items-start gap-3">
          <div
            className={
              isCritical
                ? "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 ring-2 ring-amber-400/60"
                : "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 ring-2 ring-sky-400/50"
            }
          >
            <Database className={isCritical ? "h-5 w-5 text-amber-300" : "h-4 w-4 text-sky-300"} />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={
                isCritical
                  ? "flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-200"
                  : "flex items-center gap-2 text-sm font-semibold text-sky-200"
              }
            >
              <AlertTriangle className={isCritical ? "h-4 w-4 text-amber-400" : "h-4 w-4 text-sky-400"} />
              {title}
            </p>
            <p className={isCritical ? "mt-1 text-sm text-amber-100/90" : "mt-1 text-sm text-sky-100/90"}>
              {subtitle}
            </p>
            <p className={isCritical ? "mt-2 text-xs text-amber-200/70" : "mt-2 text-xs text-sky-200/70"}>
              Supabase Dashboard → <strong>SQL Editor</strong> → New query → paste entire file → Run.
            </p>
          </div>
          <a
            href="https://supabase.com/dashboard/project/_/sql/new"
            target="_blank"
            rel="noopener noreferrer"
            className={
              isCritical
                ? "hidden shrink-0 items-center gap-1 rounded-md bg-amber-500 px-3 py-2 text-xs font-medium text-amber-950 hover:bg-amber-400 sm:flex"
                : "hidden shrink-0 items-center gap-1 rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-sky-950 hover:bg-sky-400 sm:flex"
            }
          >
            Open SQL Editor
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <ol className="grid gap-2 sm:grid-cols-2">
          {files.map(({ file, label }, i) => (
            <li
              key={file}
              className={
                isCritical
                  ? "flex items-start gap-2 rounded-md border border-amber-500/40 bg-black/30 px-3 py-2 font-mono text-xs"
                  : "flex items-start gap-2 rounded-md border border-sky-500/40 bg-black/20 px-3 py-2 font-mono text-xs"
              }
            >
              <span
                className={
                  isCritical
                    ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-amber-950"
                    : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-sky-950"
                }
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate">{migrationPath(file)}</p>
                <p className={isCritical ? "text-[10px] text-amber-300/70" : "text-[10px] text-sky-300/70"}>
                  {label}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {footer && (
          <p className={isCritical ? "text-[11px] text-amber-300/60" : "text-[11px] text-sky-300/60"}>
            {footer}
          </p>
        )}
      </div>
    </div>
  );
}
