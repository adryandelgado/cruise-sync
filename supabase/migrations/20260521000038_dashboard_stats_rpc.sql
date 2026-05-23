-- ============================================================================
-- ShipSync — Dashboard stats (single RPC for home page)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id           uuid;
  v_open_cspos       int;
  v_vessels          int;
  v_value_at_sea     numeric(14, 2);
  v_packing_queue    int;
  v_todays_deliveries int;
  v_procurement_queue int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT
    count(*)::int,
    count(DISTINCT c.vessel_id)::int
  INTO v_open_cspos, v_vessels
  FROM public.cruise_ship_pos c
  WHERE c.org_id = v_org_id
    AND c.status NOT IN ('closed', 'cancelled');

  SELECT coalesce(sum(s.open_balance), 0)
  INTO v_value_at_sea
  FROM public.cspo_live_summary s
  WHERE s.org_id = v_org_id
    AND s.status IN ('on_vessel', 'in_progress', 'closing');

  SELECT count(*)::int
  INTO v_todays_deliveries
  FROM public.cruise_ship_pos c
  WHERE c.org_id = v_org_id
    AND c.status = 'in_transit';

  SELECT count(*)::int
  INTO v_packing_queue
  FROM (
    SELECT ml.id
    FROM public.material_lists ml
    JOIN public.cruise_ship_pos c ON c.id = ml.cspo_id
    LEFT JOIN public.material_list_items mli ON mli.list_id = ml.id
    WHERE ml.org_id = v_org_id
      AND ml.status IN (
        'submitted', 'in_packing', 'partially_packed', 'awaiting_procurement'
      )
      AND c.status IN ('active', 'packing')
    GROUP BY ml.id
    HAVING coalesce(
      sum(greatest(mli.requested_qty - mli.packed_qty, 0)),
      0
    ) > 0
  ) packing_jobs;

  SELECT coalesce(w.open_procurement, 0)::int
  INTO v_procurement_queue
  FROM public.warehouse_load w
  WHERE w.org_id = v_org_id;

  IF v_procurement_queue IS NULL THEN
    v_procurement_queue := 0;
  END IF;

  RETURN json_build_object(
    'open_cspos', v_open_cspos,
    'value_at_sea', v_value_at_sea,
    'vessels_under_service', v_vessels,
    'packing_queue', v_packing_queue,
    'todays_deliveries', v_todays_deliveries,
    'procurement_queue', v_procurement_queue
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
