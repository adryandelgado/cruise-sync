-- ============================================================================
-- ShipSync — Inventory catalog hub + material instances list RPCs
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_inventory_catalog_hub()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  RETURN json_build_object(
    'stock', COALESCE((
      SELECT json_agg(row ORDER BY row->>'sku_code')
      FROM (
        SELECT json_build_object(
          'sku_id', ss.sku_id,
          'org_id', ss.org_id,
          'sku_code', ss.sku_code,
          'name', ss.name,
          'category', ss.category,
          'unit_of_measure', ss.unit_of_measure,
          'default_cost', ss.default_cost,
          'reorder_threshold', ss.reorder_threshold,
          'on_hand', ss.on_hand,
          'allocated', ss.allocated,
          'in_field', ss.in_field
        ) AS row
        FROM public.sku_stock_summary ss
        WHERE ss.org_id = v_org_id
      ) sub
    ), '[]'::json),
    'summary', (
      SELECT json_build_object(
        'sku_count', count(*)::int,
        'low_stock_count', count(*) FILTER (
          WHERE ss.reorder_threshold IS NOT NULL
            AND ss.on_hand <= ss.reorder_threshold
        )::int,
        'total_on_hand', coalesce(sum(ss.on_hand), 0)::int
      )
      FROM public.sku_stock_summary ss
      WHERE ss.org_id = v_org_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_material_instances(
  p_status  text DEFAULT NULL,
  p_limit   int DEFAULT 200
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id     uuid;
  v_total      int;
  v_limit      int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_limit := greatest(1, least(coalesce(p_limit, 200), 500));

  SELECT count(*)::int INTO v_total
  FROM public.material_instances mi
  WHERE mi.org_id = v_org_id
    AND (p_status IS NULL OR mi.status::text = p_status);

  RETURN json_build_object(
    'instances', COALESCE((
      SELECT json_agg(row ORDER BY row->>'created_at' DESC)
      FROM (
        SELECT json_build_object(
          'id', mi.id,
          'status', mi.status,
          'serial_number', mi.serial_number,
          'lot_number', mi.lot_number,
          'acquired_cost', mi.acquired_cost,
          'acquired_at', mi.acquired_at,
          'notes', mi.notes,
          'created_at', mi.created_at,
          'sku', json_build_object(
            'id', s.id,
            'sku_code', s.sku_code,
            'name', s.name,
            'unit_of_measure', s.unit_of_measure
          ),
          'location', CASE
            WHEN l.id IS NOT NULL THEN json_build_object('name', l.name, 'code', l.code)
            ELSE NULL
          END,
          'cspo', CASE
            WHEN c.id IS NOT NULL THEN json_build_object('cspo_number', c.cspo_number)
            ELSE NULL
          END
        ) AS row
        FROM public.material_instances mi
        JOIN public.skus s ON s.id = mi.sku_id
        LEFT JOIN public.locations l ON l.id = mi.current_location_id
        LEFT JOIN public.cruise_ship_pos c ON c.id = mi.current_cspo_id
        WHERE mi.org_id = v_org_id
          AND (p_status IS NULL OR mi.status::text = p_status)
        ORDER BY mi.created_at DESC
        LIMIT v_limit
      ) sub
    ), '[]'::json),
    'total_count', v_total,
    'truncated', v_total > v_limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_catalog_hub() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_material_instances(text, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
