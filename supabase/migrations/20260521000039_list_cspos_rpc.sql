-- ============================================================================
-- ShipSync — CSPO list (single RPC for list page)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_cspos()
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
    SELECT json_agg(row ORDER BY row->>'created_at' DESC)
    FROM (
      SELECT json_build_object(
        'id', c.id,
        'cspo_number', c.cspo_number,
        'status', c.status,
        'attendance_type', c.attendance_type,
        'original_value', c.original_value,
        'currency', c.currency,
        'planned_start', c.planned_start,
        'planned_end', c.planned_end,
        'created_at', c.created_at,
        'vessel', json_build_object(
          'id', v.id,
          'name', v.name,
          'fleet', CASE
            WHEN f.id IS NOT NULL THEN json_build_object('id', f.id, 'name', f.name)
            ELSE NULL
          END
        )
      ) AS row
      FROM public.cruise_ship_pos c
      JOIN public.vessels v ON v.id = c.vessel_id
      LEFT JOIN public.fleets f ON f.id = v.fleet_id
      WHERE c.org_id = v_org_id
    ) sub
  ), '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_cspos() TO authenticated;

NOTIFY pgrst, 'reload schema';
