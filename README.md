# ShipSync

Operations & logistics platform for cruise ship contractors. See the full architecture blueprint for context; this repo is the **web + tablet PWA** half of the system.

## Stack

- **Vite 6** + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first config)
- **TanStack Router** (file-based) + **TanStack Query**
- **Supabase** (Postgres + Auth + Storage + Realtime)
- **vite-plugin-pwa** for installable tablet/iPad use
- Hand-rolled shadcn-style primitives (`src/components/ui`)

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL + anon key
npm run dev
```

Visit http://localhost:5173.

If `.env.local` is empty the app still renders, with a banner reminding you to fill it in. Any code that actually calls Supabase will throw with a clear message until configured.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript project build, no emit |
| `npm run db:types` | Hint for generating Supabase types (run the printed command) |

## Database setup

The Postgres schema lives in [`supabase/migrations/`](supabase/migrations/).
Two ways to apply it to your Supabase project:

### Option A — Dashboard SQL editor (no install)

> **ACTION REQUIRED** — When the app shows the amber **“Paste SQL in Supabase”** banner, open your project dashboard → **SQL Editor** → **New query**, paste each migration file **in full**, and click **Run**. One file per query, in numeric order.

In the Supabase dashboard for your project (project ref is in the URL — e.g.
`oeqkrphmtqlyuyollxck`), open **SQL Editor → New query**, then paste and run
each file **in order**:

1. [`supabase/migrations/20260520000001_init_schema.sql`](supabase/migrations/20260520000001_init_schema.sql) — tables, enums, helpers, views
2. [`supabase/migrations/20260520000002_rls.sql`](supabase/migrations/20260520000002_rls.sql) — Row Level Security policies
3. [`supabase/migrations/20260520000003_dev_helpers.sql`](supabase/migrations/20260520000003_dev_helpers.sql) — health check RPC
4. [`supabase/migrations/20260521000001_proposals_and_material_lists.sql`](supabase/migrations/20260521000001_proposals_and_material_lists.sql) — **must run before #5**
5. [`supabase/migrations/20260521000002_packing.sql`](supabase/migrations/20260521000002_packing.sql) — packages, docs, pack RPCs
6. [`supabase/migrations/20260521000003_dev_pm_role.sql`](supabase/migrations/20260521000003_dev_pm_role.sql) — promote dev users to pm
7. [`supabase/migrations/20260521000004_onboard_operations.sql`](supabase/migrations/20260521000004_onboard_operations.sql) — receive, usage log, transfers, returns
8. [`supabase/migrations/20260521000005_procurement_and_sales.sql`](supabase/migrations/20260521000005_procurement_and_sales.sql) — procurement, purchase orders, sales quotes/orders
9. [`supabase/migrations/20260521000006_closure_restock_audit.sql`](supabase/migrations/20260521000006_closure_restock_audit.sql) — restock, CSPO closure, audit log, report views
10. [`supabase/migrations/20260521000007_schema_diagnostics.sql`](supabase/migrations/20260521000007_schema_diagnostics.sql) — schema diagnostics helper
11. [`supabase/migrations/20260521000008_analytics_views.sql`](supabase/migrations/20260521000008_analytics_views.sql) — vessel/fleet/SKU analytics reports
12. [`supabase/migrations/20260521000009_health_check_fix.sql`](supabase/migrations/20260521000009_health_check_fix.sql) — correct table count (32/32)
13. [`supabase/migrations/20260521000010_onboard_workflow_fixes.sql`](supabase/migrations/20260521000010_onboard_workflow_fixes.sql) — onboard fixes + demo CSPO `DEMO-44521`
14. [`supabase/migrations/20260521000011_procurement_fixes.sql`](supabase/migrations/20260521000011_procurement_fixes.sql) — procurement request/receive fixes
15. [`supabase/migrations/20260521000012_procurement_receive_unblock.sql`](supabase/migrations/20260521000012_procurement_receive_unblock.sql) — receive stock → unblock warehouse packing
16. [`supabase/seed.sql`](supabase/seed.sql) — default org + fleets + sample SKUs (idempotent)

### Option B — Supabase CLI (recommended once you're iterating on schema)

```bash
brew install supabase/tap/supabase    # one-time
supabase init                          # creates supabase/config.toml
supabase link --project-ref oeqkrphmtqlyuyollxck
supabase db push                       # applies pending migrations
# seed.sql isn't auto-run against linked projects:
psql "$(supabase db remote-url)" -f supabase/seed.sql
```

Use `supabase migration new <name>` for future changes — it creates a
correctly-timestamped file in `supabase/migrations/`.

## Generating Supabase types

Once your schema is deployed:

```bash
npx supabase gen types typescript \
  --project-id <your-project-ref> \
  --schema public > src/lib/database.types.ts
```

Then import as `import type { Database } from "@/lib/database.types"` and pass it as `createClient<Database>(...)` in [`src/lib/supabase.ts`](src/lib/supabase.ts).

## Project layout

```
src/
  components/
    layout/       # Sidebar, EnvBanner, app shell pieces
    ui/           # Button, Card, ... (shadcn-style primitives)
  lib/
    env.ts        # Typed env access with helpful errors
    supabase.ts   # Lazy Supabase client
    queryClient.ts
    utils.ts      # cn(), formatCurrency()
  routes/         # TanStack Router file-based routes
    __root.tsx
    index.tsx     # Dashboard
    cspos/
    proposals/
    inventory/
    procurement/
    warehouse/
  router.tsx
  main.tsx
  styles.css      # @import "tailwindcss" + @theme tokens
```

## What's next

Follow the build sequence from the blueprint:

1. **Phase 0** — schema, auth, RLS, web shell.
2. **Phase 1** — inventory catalog, instances, movement history, CSV import.
3. **Phase 2** — proposals, CSPO activation, material list builder.
4. **Phase 3** — warehouse pack flow, COI/POD docs.
5. **Phase 4** — onboard receive, usage log, returns, transfers.
6. **Phase 5** — warehouse restock, CSPO closure, audit log.
7. **Phase 6** — reports (all 8 critical report types + CSV export).
8. **Phase 7** — analytics views, migration banner, material trace.

Deferred: WatermelonDB offline sync, email/PDF edge functions, QuickBooks.
