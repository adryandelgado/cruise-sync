-- ============================================================================
-- ShipSync — Dev/health helpers
--
-- health_check() is callable by the anon key (no auth required) so the
-- frontend can verify both connectivity AND that the schema was applied,
-- without exposing any business data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.health_check()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'status', 'ok',
    'schema_version', '20260520000001',
    'tables_found', (
      SELECT count(*)::int
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY[
          'orgs', 'profiles', 'fleets', 'vessels', 'suppliers',
          'locations', 'skus', 'material_instances',
          'inventory_movements', 'cruise_ship_pos', 'cspo_value_ledger'
        ])
    ),
    'tables_expected', 11
  );
$$;

GRANT EXECUTE ON FUNCTION public.health_check() TO anon, authenticated;
