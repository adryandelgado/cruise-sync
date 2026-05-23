-- ============================================================================
-- ShipSync — CSPO detail session (single query)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cspo_detail_session(p_cspo_id uuid)
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
        'attendance_type', c.attendance_type,
        'port_of_service', c.port_of_service,
        'original_value', c.original_value,
        'currency', c.currency,
        'planned_start', c.planned_start,
        'planned_end', c.planned_end,
        'actual_start', c.actual_start,
        'actual_end', c.actual_end,
        'closure_notes', c.closure_notes,
        'created_at', c.created_at,
        'vessel', json_build_object(
          'id', v.id,
          'name', v.name,
          'fleet', CASE
            WHEN f.id IS NOT NULL THEN json_build_object('id', f.id, 'name', f.name)
            ELSE NULL
          END
        ),
        'pm', CASE
          WHEN pm.id IS NOT NULL THEN json_build_object(
            'id', pm.id,
            'full_name', pm.full_name,
            'email', pm.email
          )
          ELSE NULL
        END,
        'bookkeeper', CASE
          WHEN bk.id IS NOT NULL THEN json_build_object(
            'id', bk.id,
            'full_name', bk.full_name,
            'email', bk.email
          )
          ELSE NULL
        END
      )
      FROM public.cruise_ship_pos c
      JOIN public.vessels v ON v.id = c.vessel_id
      LEFT JOIN public.fleets f ON f.id = v.fleet_id
      LEFT JOIN public.profiles pm ON pm.id = c.assigned_pm
      LEFT JOIN public.profiles bk ON bk.id = c.assigned_bookkeeper
      WHERE c.id = p_cspo_id
    ),
    'financial', public.get_cspo_financial_summary(p_cspo_id),
    'workflow', public.get_cspo_workflow_summary(p_cspo_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cspo_detail_session(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
