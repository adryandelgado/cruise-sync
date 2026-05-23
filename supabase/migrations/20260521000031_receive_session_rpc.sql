-- ============================================================================
-- ShipSync — Onboard receive session (single query)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_receive_session(p_cspo_id uuid)
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
        'id', c.id,
        'cspo_number', c.cspo_number,
        'status', c.status,
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
    'packages', COALESCE((
      SELECT json_agg(row ORDER BY (row->>'package_number')::int)
      FROM (
        SELECT json_build_object(
          'id', p.id,
          'package_type', p.package_type,
          'package_number', p.package_number,
          'status', p.status,
          'received', (r.id IS NOT NULL),
          'receipt', CASE
            WHEN r.id IS NOT NULL THEN json_build_object(
              'received_at', r.received_at,
              'discrepancy_notes', r.discrepancy_notes
            )
            ELSE NULL
          END,
          'trackable_count', COALESCE((
            SELECT count(*)::int
            FROM public.package_contents pc
            WHERE pc.package_id = p.id
              AND pc.material_instance_id IS NOT NULL
          ), 0),
          'custom_count', COALESCE((
            SELECT count(*)::int
            FROM public.package_contents pc
            WHERE pc.package_id = p.id
              AND pc.material_instance_id IS NULL
          ), 0)
        ) AS row
        FROM public.packages p
        LEFT JOIN public.onboard_receipts r
          ON r.package_id = p.id AND r.cspo_id = p_cspo_id
        WHERE p.cspo_id = p_cspo_id AND p.org_id = v_org_id
        ORDER BY p.package_number
      ) pkg_sub
    ), '[]'::json),
    'items_on_vessel', COALESCE((
      SELECT count(*)::int
      FROM public.material_instances mi
      WHERE mi.current_cspo_id = p_cspo_id
        AND mi.status = 'on_vessel'
    ), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_receive_session(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
