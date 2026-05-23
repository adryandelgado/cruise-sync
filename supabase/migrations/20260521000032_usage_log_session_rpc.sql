-- ============================================================================
-- ShipSync — Daily usage log session (single query)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_usage_log_session(p_cspo_id uuid)
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

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  RETURN json_build_object(
    'cspo', (
      SELECT json_build_object(
        'cspo_number', c.cspo_number,
        'vessel', json_build_object(
          'name', v.name,
          'fleet', CASE
            WHEN f.id IS NOT NULL THEN json_build_object('name', f.name)
            ELSE NULL
          END
        )
      )
      FROM public.cruise_ship_pos c
      JOIN public.vessels v ON v.id = c.vessel_id
      LEFT JOIN public.fleets f ON f.id = v.fleet_id
      WHERE c.id = p_cspo_id
    ),
    'inventory', public.onboard_sku_inventory(p_cspo_id),
    'usage_logs', COALESCE((
      SELECT json_agg(row ORDER BY row->>'logged_at' DESC)
      FROM (
        SELECT json_build_object(
          'id', ul.id,
          'action_type', ul.action_type,
          'logged_at', ul.logged_at,
          'notes', ul.notes,
          'location_on_vessel', ul.location_on_vessel,
          'qty', ul.qty,
          'material_instance', json_build_object(
            'sku', CASE
              WHEN s.id IS NOT NULL THEN json_build_object(
                'sku_code', s.sku_code,
                'name', s.name
              )
              ELSE NULL
            END
          )
        ) AS row
        FROM public.usage_logs ul
        JOIN public.material_instances mi ON mi.id = ul.material_instance_id
        LEFT JOIN public.skus s ON s.id = mi.sku_id
        WHERE ul.cspo_id = p_cspo_id
          AND ul.org_id = v_org_id
        ORDER BY ul.logged_at DESC
        LIMIT 100
      ) log_sub
    ), '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_log_session(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
