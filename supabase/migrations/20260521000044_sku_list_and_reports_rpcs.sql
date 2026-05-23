-- ============================================================================
-- ShipSync — SKU list + reports RPCs (pickers, bookkeeper, material search)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_skus()
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

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'sku_code')
    FROM (
      SELECT json_build_object(
        'id', s.id,
        'sku_code', s.sku_code,
        'name', s.name,
        'category', s.category,
        'unit_of_measure', s.unit_of_measure,
        'default_cost', s.default_cost,
        'active', s.active
      ) AS row
      FROM public.skus s
      WHERE s.org_id = v_org_id
        AND s.active = true
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bookkeeper_performance_report()
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

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY (row->>'cspo_count')::int DESC)
    FROM (
      SELECT json_build_object(
        'bookkeeper_id', p.id,
        'full_name', coalesce(p.full_name, p.email),
        'email', p.email,
        'cspo_count', count(*)::int,
        'closed_count', count(*) FILTER (WHERE r.status = 'closed')::int,
        'avg_variance_pct', coalesce(
          round(avg(r.variance_pct) FILTER (WHERE r.status = 'closed'), 1),
          0
        ),
        'total_open_balance', coalesce(sum(r.open_balance), 0)
      ) AS row
      FROM public.cspo_closure_report r
      JOIN public.cruise_ship_pos c ON c.id = r.cspo_id
      JOIN public.profiles p ON p.id = c.assigned_bookkeeper
      WHERE c.org_id = v_org_id
        AND c.assigned_bookkeeper IS NOT NULL
      GROUP BY p.id, p.full_name, p.email
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.search_material_instances(
  p_query text,
  p_limit   int DEFAULT 20
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_q      text;
  v_limit  int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_q := trim(coalesce(p_query, ''));
  IF length(v_q) < 2 THEN
    RETURN '[]'::json;
  END IF;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));

  RETURN COALESCE((
    SELECT json_agg(row)
    FROM (
      SELECT json_build_object(
        'id', mi.id,
        'status', mi.status,
        'serial_number', mi.serial_number,
        'sku', json_build_object(
          'sku_code', s.sku_code,
          'name', s.name
        )
      ) AS row
      FROM public.material_instances mi
      JOIN public.skus s ON s.id = mi.sku_id
      WHERE mi.org_id = v_org_id
        AND (
          mi.serial_number ILIKE '%' || v_q || '%'
          OR s.sku_code ILIKE '%' || v_q || '%'
          OR s.name ILIKE '%' || v_q || '%'
        )
      ORDER BY mi.created_at DESC
      LIMIT v_limit
    ) sub
  ), '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_skus() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bookkeeper_performance_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_material_instances(text, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
