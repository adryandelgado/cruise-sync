-- ============================================================================
-- ShipSync — CSPO workflow banner summary (single query)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cspo_workflow_summary(p_cspo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_list_status text;
  v_list_item_count int;
  v_total_packages int;
  v_received_packages int;
  v_units_aboard int;
  v_sku_count_aboard int;
  v_blocker_count int;
  v_pending_outbound int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  SELECT ml.status, count(mli.id)::int
  INTO v_list_status, v_list_item_count
  FROM public.material_lists ml
  LEFT JOIN public.material_list_items mli ON mli.list_id = ml.id
  WHERE ml.cspo_id = p_cspo_id AND ml.org_id = v_org_id
  GROUP BY ml.id, ml.status;

  v_list_status := COALESCE(v_list_status, NULL);
  v_list_item_count := COALESCE(v_list_item_count, 0);

  SELECT count(*)::int INTO v_total_packages
  FROM public.packages WHERE cspo_id = p_cspo_id;

  SELECT count(*)::int INTO v_received_packages
  FROM public.onboard_receipts WHERE cspo_id = p_cspo_id;

  SELECT count(*)::int, count(DISTINCT mi.sku_id)::int
  INTO v_units_aboard, v_sku_count_aboard
  FROM public.material_instances mi
  WHERE mi.org_id = v_org_id
    AND mi.current_cspo_id = p_cspo_id
    AND mi.status = 'on_vessel';

  SELECT count(*)::int INTO v_blocker_count
  FROM public.material_instances mi
  WHERE mi.org_id = v_org_id
    AND mi.current_cspo_id = p_cspo_id
    AND mi.status IN ('on_vessel', 'packed', 'in_transit', 'allocated');

  SELECT count(*)::int INTO v_pending_outbound
  FROM public.transfer_events te
  WHERE te.from_cspo_id = p_cspo_id
    AND te.acknowledged_at IS NULL;

  RETURN json_build_object(
    'list_status', v_list_status,
    'list_item_count', v_list_item_count,
    'total_packages', v_total_packages,
    'received_packages', v_received_packages,
    'pending_receipts', greatest(v_total_packages - v_received_packages, 0),
    'units_aboard', v_units_aboard,
    'sku_count_aboard', v_sku_count_aboard,
    'blocker_count', v_blocker_count,
    'pending_outbound_transfers', v_pending_outbound
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cspo_workflow_summary(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
