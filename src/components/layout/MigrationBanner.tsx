import {
  ALL_MIGRATIONS,
  SEED_FILE,
  migrationsFromTableCount,
} from "@/lib/migrations";
import { useAnalyticsHealth } from "@/hooks/useAnalyticsHealth";
import { useSupabaseHealth } from "@/hooks/useSupabaseHealth";
import { SqlMigrationHighlight } from "@/components/layout/SqlMigrationHighlight";

/**
 * Prominent banner — impossible to miss when SQL migrations are pending.
 * Shown at the top of every authenticated page until schema is complete.
 */
export function MigrationBanner() {
  const { data, isLoading } = useSupabaseHealth();
  const { data: analytics, isLoading: loadingAnalytics } = useAnalyticsHealth();

  if (isLoading) return null;

  if (!data || data.state === "not_configured") return null;

  if (data.state === "schema_missing") {
    const files = ALL_MIGRATIONS.slice(0, 3).map((m) => ({
      file: m.file,
      label: m.label,
    }));

    return (
      <>
        <SqlMigrationHighlight
          subtitle="Base schema not detected. Start with migrations 1–3, then continue in order."
          files={files}
          footer={`Then run seed data: ${SEED_FILE}. Hard-refresh after each batch (Cmd+Shift+R).`}
        />
      </>
    );
  }

  if (data.state === "connected" && !data.schemaOk) {
    const pending =
      data.pendingMigrations && data.pendingMigrations.length > 0
        ? data.pendingMigrations
        : migrationsFromTableCount(data.tablesFound);

    const files = pending.map((file) => {
      const meta = ALL_MIGRATIONS.find((m) => m.file === file);
      return { file, label: meta?.label ?? file };
    });

    if (files.length === 0) return null;

    const showSeed = data.tablesFound >= 11 && data.tablesFound < 14;

    return (
      <SqlMigrationHighlight
        subtitle={`Schema incomplete (${data.tablesFound}/${data.tablesExpected} tables). Paste each file below — one file per SQL Editor query, in order.`}
        files={files}
        footer={
          showSeed
            ? `After migrations, run ${SEED_FILE}. Banner clears when schema is complete. Hard-refresh when done.`
            : "Hard-refresh when done (Cmd+Shift+R). Banner clears when schema is complete."
        }
      />
    );
  }

  if (
    data.state === "connected" &&
    data.schemaOk &&
    !loadingAnalytics &&
    analytics &&
    !analytics.ready
  ) {
    const file = ALL_MIGRATIONS[10];
    return (
      <SqlMigrationHighlight
        variant="optional"
        title="Reports need one more SQL file"
        subtitle="All core tables are present. Run the analytics migration so Reports tabs (vessel spend, fleet comparison, etc.) work."
        files={[{ file: file.file, label: file.label }]}
        footer="Hard-refresh after running. This is migration 11 of 11."
      />
    );
  }

  return null;
}
