-- ============================================================================
-- ShipSync — Pack job queue + CSPO blocking inventory summaries
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_pack_jobs()
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
    SELECT json_agg(row ORDER BY row->>'submitted_at' NULLS LAST)
    FROM (
      SELECT json_build_object(
        'cspo_id', c.id,
        'cspo_number', c.cspo_number,
        'status', c.status,
        'attendance_type', c.attendance_type,
        'planned_end', c.planned_end,
        'submitted_at', ml.submitted_at,
        'vessel', json_build_object(
          'id', v.id,
          'name', v.name,
          'fleet', CASE
            WHEN f.id IS NOT NULL THEN json_build_object('name', f.name)
            ELSE NULL
          END
        ),
        'material_list', json_build_object(
          'id', ml.id,
          'status', ml.status,
          'item_count', count(mli.id)::int,
          'packed_count', count(*) FILTER (
            WHERE mli.packed_qty >= mli.requested_qty
          )::int,
          'total_units', coalesce(sum(mli.requested_qty), 0)::numeric,
          'packed_units', coalesce(
            sum(least(mli.packed_qty, mli.requested_qty)),
            0
          )::numeric,
          'remaining_units', coalesce(
            sum(greatest(mli.requested_qty - mli.packed_qty, 0)),
            0
          )::numeric,
          'is_fully_packed', (
            count(mli.id) > 0
            AND coalesce(sum(least(mli.packed_qty, mli.requested_qty)), 0)
              >= coalesce(sum(mli.requested_qty), 0)
          )
        )
      ) AS row
      FROM public.material_lists ml
      JOIN public.cruise_ship_pos c ON c.id = ml.cspo_id
      JOIN public.vessels v ON v.id = c.vessel_id
      LEFT JOIN public.fleets f ON f.id = v.fleet_id
      LEFT JOIN public.material_list_items mli ON mli.list_id = ml.id
      WHERE ml.org_id = v_org_id
        AND ml.status IN (
          'submitted', 'in_packing', 'partially_packed', 'awaiting_procurement'
        )
        AND c.status IN ('active', 'packing')
      GROUP BY ml.id, ml.status, ml.submitted_at, c.id, c.cspo_number, c.status,
        c.attendance_type, c.planned_end, v.id, v.name, f.id, f.name
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cspo_blocking_summary(p_cspo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_count int;
  v_groups json;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  SELECT count(*)::int INTO v_count
  FROM public.material_instances mi
  WHERE mi.org_id = v_org_id
    AND mi.current_cspo_id = p_cspo_id
    AND mi.status IN ('on_vessel', 'packed', 'in_transit', 'allocated');

  SELECT COALESCE(json_agg(g ORDER BY g->>'name'), '[]'::json) INTO v_groups
  FROM (
    SELECT json_build_object(
      'sku_code', s.sku_code,
      'name', s.name,
      'qty', count(*)::int,
      'statuses', COALESCE(array_agg(DISTINCT mi.status), ARRAY[]::text[])
    ) AS g
    FROM public.material_instances mi
    JOIN public.skus s ON s.id = mi.sku_id
    WHERE mi.org_id = v_org_id
      AND mi.current_cspo_id = p_cspo_id
      AND mi.status IN ('on_vessel', 'packed', 'in_transit', 'allocated')
    GROUP BY mi.sku_id, s.sku_code, s.name
  ) sub;

  RETURN json_build_object(
    'blocker_count', v_count,
    'groups', v_groups
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_pack_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cspo_blocking_summary(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
