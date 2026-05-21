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

In the Supabase dashboard for your project (project ref is in the URL — e.g.
`oeqkrphmtqlyuyollxck`), open **SQL Editor → New query**, then paste and run
each file **in order**:

1. [`supabase/migrations/20260520000001_init_schema.sql`](supabase/migrations/20260520000001_init_schema.sql) — tables, enums, helpers, views
2. [`supabase/migrations/20260520000002_rls.sql`](supabase/migrations/20260520000002_rls.sql) — Row Level Security policies
3. [`supabase/seed.sql`](supabase/seed.sql) — default org + fleets + sample SKUs (idempotent)

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

1. **Phase 0** — schema for `fleets`, `vessels`, `profiles`, `skus`, `material_instances`, `inventory_movements`, `cruise_ship_pos`, `cspo_value_ledger` + RLS skeleton.
2. **Phase 1** — inventory CRUD + ledger.
3. **Phase 2** — proposals + CSPO activation + material list builder.
4. **Phase 3** — warehouse tablet pack flow (the offline-first PWA bit).

The dashboard at `/` is the seam where every later phase will wire in.
