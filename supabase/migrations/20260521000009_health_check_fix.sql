-- ============================================================================
-- ShipSync — Fix health_check table count (was 29 listed, expected 28)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.health_check()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'status', 'ok',
    'schema_version', '20260521000009',
    'tables_found', (
      SELECT count(*)::int
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY[
          'orgs', 'profiles', 'fleets', 'vessels', 'suppliers', 'locations', 'skus',
          'material_instances', 'inventory_movements', 'cruise_ship_pos', 'cspo_value_ledger',
          'proposals', 'proposal_line_items', 'material_lists', 'material_list_items',
          'packages', 'package_contents', 'commercial_invoices', 'pods',
          'onboard_receipts', 'usage_logs', 'transfer_events',
          'return_manifests', 'return_manifest_items',
          'procurement_requests', 'purchase_orders', 'purchase_order_lines',
          'sales_quotes', 'sales_quote_lines', 'sales_orders', 'sales_order_lines',
          'audit_events'
        ])
    ),
    'tables_expected', 32
  );
$$;

CREATE OR REPLACE FUNCTION public.schema_status()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH expected AS (
    SELECT * FROM (VALUES
      ('proposals',                    '20260521000001_proposals_and_material_lists.sql'),
      ('material_lists',               '20260521000001_proposals_and_material_lists.sql'),
      ('material_list_items',          '20260521000001_proposals_and_material_lists.sql'),
      ('packages',                     '20260521000002_packing.sql'),
      ('package_contents',             '20260521000002_packing.sql'),
      ('commercial_invoices',          '20260521000002_packing.sql'),
      ('pods',                         '20260521000002_packing.sql'),
      ('onboard_receipts',             '20260521000004_onboard_operations.sql'),
      ('usage_logs',                   '20260521000004_onboard_operations.sql'),
      ('transfer_events',              '20260521000004_onboard_operations.sql'),
      ('return_manifests',             '20260521000004_onboard_operations.sql'),
      ('return_manifest_items',        '20260521000004_onboard_operations.sql'),
      ('procurement_requests',         '20260521000005_procurement_and_sales.sql'),
      ('purchase_orders',              '20260521000005_procurement_and_sales.sql'),
      ('purchase_order_lines',         '20260521000005_procurement_and_sales.sql'),
      ('sales_quotes',                 '20260521000005_procurement_and_sales.sql'),
      ('sales_quote_lines',            '20260521000005_procurement_and_sales.sql'),
      ('sales_orders',                 '20260521000005_procurement_and_sales.sql'),
      ('sales_order_lines',            '20260521000005_procurement_and_sales.sql'),
      ('audit_events',                 '20260521000006_closure_restock_audit.sql')
    ) AS t(table_name, migration)
  ),
  missing AS (
    SELECT e.table_name, e.migration
    FROM expected e
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.tables i
      WHERE i.table_schema = 'public' AND i.table_name = e.table_name
    )
  )
  SELECT json_build_object(
    'ok', (SELECT count(*) = 0 FROM missing),
    'missing', COALESCE(
      (SELECT json_agg(json_build_object('table', table_name, 'migration', migration))
       FROM missing),
      '[]'::json
    ),
    'next_step', CASE
      WHEN (SELECT count(*) FROM missing) = 0
        THEN 'Schema complete — hard-refresh the app (Cmd+Shift+R)'
      ELSE 'Run each migration file listed in missing[], in numeric order, via SQL Editor'
    END
  );
$$;

NOTIFY pgrst, 'reload schema';
