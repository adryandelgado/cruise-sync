-- ============================================================================
-- ShipSync — Bulk SKU usage logging aboard (qty-based daily log)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_sku_usage_qty(
  p_cspo_id       uuid,
  p_sku_id        uuid,
  p_action_type   public.usage_action_type,
  p_qty           numeric DEFAULT 1,
  p_notes         text DEFAULT NULL,
  p_location      text DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_to_log   int;
  v_logged   int := 0;
  v_instance uuid;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Qty must be positive';
  END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_action_type NOT IN ('consumed', 'installed', 'damaged') THEN
    RAISE EXCEPTION 'Action % is not supported for bulk SKU logging', p_action_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  v_to_log := FLOOR(p_qty)::int;

  FOR v_instance IN
    SELECT mi.id
    FROM public.material_instances mi
    WHERE mi.org_id = v_org_id
      AND mi.current_cspo_id = p_cspo_id
      AND mi.sku_id = p_sku_id
      AND mi.status = 'on_vessel'
    ORDER BY mi.created_at
    LIMIT v_to_log
  LOOP
    PERFORM public.log_material_usage(
      v_instance,
      p_action_type,
      p_notes,
      p_location,
      p_performed_by
    );
    v_logged := v_logged + 1;
  END LOOP;

  IF v_logged = 0 THEN
    RAISE EXCEPTION 'No on-vessel instances available for this SKU on this CSPO';
  END IF;

  RETURN json_build_object(
    'logged', v_logged,
    'remaining_on_vessel', (
      SELECT count(*)::int
      FROM public.material_instances
      WHERE org_id = v_org_id
        AND current_cspo_id = p_cspo_id
        AND sku_id = p_sku_id
        AND status = 'on_vessel'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_sku_usage_qty(
  uuid, uuid, public.usage_action_type, numeric, text, text, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
