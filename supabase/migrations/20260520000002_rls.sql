-- ============================================================================
-- ShipSync — Row Level Security
--
-- Strategy:
--   * Reads (SELECT) are scoped to the caller's org for every business table.
--   * Writes (INSERT/UPDATE/DELETE) are gated by role using has_role().
--   * Append-only ledger tables (inventory_movements, cspo_value_ledger)
--     allow INSERT from any active user in the org; UPDATE/DELETE are
--     blocked at trigger level (see init_schema.sql).
--
-- All policies are written against the `authenticated` role. The Supabase
-- service_role bypasses RLS for admin tooling.
--
-- These policies are intentionally loose for early dev. Tighten in a
-- follow-up migration once roles solidify in practice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ORGS
-- ----------------------------------------------------------------------------
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orgs_select_own"
  ON public.orgs FOR SELECT TO authenticated
  USING (id = public.current_org_id());

CREATE POLICY "orgs_update_admin"
  ON public.orgs FOR UPDATE TO authenticated
  USING (id = public.current_org_id() AND public.has_role('admin'))
  WITH CHECK (id = public.current_org_id());

-- Creation of new orgs is admin tooling only (service_role).

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read their own profile (no org check; avoids
-- chicken-and-egg with current_org_id()).
CREATE POLICY "profiles_select_self"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- And any profile in the same org.
CREATE POLICY "profiles_select_org"
  ON public.profiles FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

-- Self-update is allowed for non-sensitive fields. Role/org changes go
-- through the admin-only policy below.
CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    AND role   = (SELECT role   FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin'))
  WITH CHECK (org_id = public.current_org_id());

-- INSERT happens via the on_auth_user_created trigger, which runs as
-- SECURITY DEFINER and bypasses RLS. No INSERT policy needed.
-- DELETE is handled by ON DELETE CASCADE from auth.users.

-- ----------------------------------------------------------------------------
-- Helper macro: org-scoped CRUD policies
--
-- For each business table we want:
--   * SELECT  → any active member of the org
--   * INSERT  → role-gated
--   * UPDATE  → role-gated
--   * DELETE  → admin-only (or role-gated)
-- Written longhand below to keep this migration self-explanatory.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- FLEETS — rarely changed; admin + pm can write
-- ----------------------------------------------------------------------------
ALTER TABLE public.fleets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fleets_select"
  ON public.fleets FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "fleets_write"
  ON public.fleets FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm'))
  WITH CHECK (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- VESSELS — admin + pm
-- ----------------------------------------------------------------------------
ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vessels_select"
  ON public.vessels FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "vessels_write"
  ON public.vessels FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm'))
  WITH CHECK (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- SUPPLIERS — admin + purchase + pm
-- ----------------------------------------------------------------------------
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_select"
  ON public.suppliers FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "suppliers_write"
  ON public.suppliers FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'purchase')
  )
  WITH CHECK (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- LOCATIONS — admin + warehouse_supervisor
-- ----------------------------------------------------------------------------
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations_select"
  ON public.locations FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "locations_write"
  ON public.locations FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'warehouse_supervisor')
  )
  WITH CHECK (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- SKUS — admin + pm + purchase + warehouse_supervisor
-- ----------------------------------------------------------------------------
ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skus_select"
  ON public.skus FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "skus_write"
  ON public.skus FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'purchase', 'warehouse_supervisor')
  )
  WITH CHECK (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- CRUISE_SHIP_POS — admin + pm
-- ----------------------------------------------------------------------------
ALTER TABLE public.cruise_ship_pos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cspos_select"
  ON public.cruise_ship_pos FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "cspos_write"
  ON public.cruise_ship_pos FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm'))
  WITH CHECK (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- MATERIAL_INSTANCES — warehouse staff + purchase + admin
-- Status changes flow through inventory_movements, not direct UPDATE.
-- ----------------------------------------------------------------------------
ALTER TABLE public.material_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "material_instances_select"
  ON public.material_instances FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "material_instances_write"
  ON public.material_instances FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role(
      'admin', 'pm',
      'warehouse_supervisor', 'warehouse_operator',
      'purchase'
    )
  )
  WITH CHECK (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- INVENTORY_MOVEMENTS — append-only ledger
-- SELECT: any org member. INSERT: any active org member. UPDATE/DELETE
-- blocked at trigger.
-- ----------------------------------------------------------------------------
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_movements_select"
  ON public.inventory_movements FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "inv_movements_insert"
  ON public.inventory_movements FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.has_role(
      'admin', 'pm',
      'warehouse_supervisor', 'warehouse_operator',
      'purchase',
      'onboard_bookkeeper', 'drydock_bookkeeper'
    )
  );

-- ----------------------------------------------------------------------------
-- CSPO_VALUE_LEDGER — append-only financial ledger
-- ----------------------------------------------------------------------------
ALTER TABLE public.cspo_value_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cspo_ledger_select"
  ON public.cspo_value_ledger FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "cspo_ledger_insert"
  ON public.cspo_value_ledger FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.has_role(
      'admin', 'pm',
      'warehouse_supervisor', 'warehouse_operator',
      'onboard_bookkeeper', 'drydock_bookkeeper'
    )
  );

-- ----------------------------------------------------------------------------
-- GRANTS
-- ----------------------------------------------------------------------------
-- Supabase grants USAGE on public and CRUD on public.* to anon/authenticated
-- by default. Re-declare explicitly so this migration is self-contained.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO authenticated;

-- Views: grant SELECT.
GRANT SELECT ON public.cspo_live_summary, public.material_lifetime_log
  TO authenticated;

-- Future objects in this schema inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES    TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES  TO authenticated;
