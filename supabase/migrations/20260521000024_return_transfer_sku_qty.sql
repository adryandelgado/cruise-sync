-- ============================================================================
-- ShipSync — Bulk return & transfer by SKU qty
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_return_sku_qty(
  p_manifest_id   uuid,
  p_cspo_id       uuid,
  p_sku_id        uuid,
  p_qty           numeric DEFAULT 1,
  p_condition     public.return_item_condition DEFAULT 'good',
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_to_add int;
  v_added  int := 0;
  v_instance uuid;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  v_to_add := FLOOR(p_qty)::int;

  FOR v_instance IN
    SELECT mi.id
    FROM public.material_instances mi
    WHERE mi.org_id = public.current_org_id()
      AND mi.current_cspo_id = p_cspo_id
      AND mi.sku_id = p_sku_id
      AND mi.status = 'on_vessel'
      AND NOT EXISTS (
        SELECT 1 FROM public.return_manifest_items rmi
        WHERE rmi.material_instance_id = mi.id
          AND rmi.manifest_id = p_manifest_id
      )
    ORDER BY mi.created_at
    LIMIT v_to_add
  LOOP
    PERFORM public.add_return_manifest_item(
      p_manifest_id, v_instance, p_condition, p_performed_by
    );
    v_added := v_added + 1;
  END LOOP;

  IF v_added = 0 THEN
    RAISE EXCEPTION 'No on-vessel instances available to add for this SKU';
  END IF;

  RETURN json_build_object(
    'added', v_added,
    'on_manifest', (
      SELECT count(*)::int
      FROM public.return_manifest_items rmi
      JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
      WHERE rmi.manifest_id = p_manifest_id
        AND mi.sku_id = p_sku_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.initiate_transfer_sku_qty(
  p_cspo_id       uuid,
  p_sku_id        uuid,
  p_to_cspo_id    uuid,
  p_qty           numeric DEFAULT 1,
  p_notes         text DEFAULT NULL,
  p_initiated_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_to_xfer int;
  v_xferred int := 0;
  v_instance uuid;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  v_to_xfer := FLOOR(p_qty)::int;

  FOR v_instance IN
    SELECT mi.id
    FROM public.material_instances mi
    WHERE mi.org_id = public.current_org_id()
      AND mi.current_cspo_id = p_cspo_id
      AND mi.sku_id = p_sku_id
      AND mi.status = 'on_vessel'
    ORDER BY mi.created_at
    LIMIT v_to_xfer
  LOOP
    PERFORM public.initiate_transfer(
      v_instance, p_to_cspo_id, p_notes, p_initiated_by
    );
    v_xferred := v_xferred + 1;
  END LOOP;

  IF v_xferred = 0 THEN
    RAISE EXCEPTION 'No on-vessel instances available to transfer for this SKU';
  END IF;

  RETURN json_build_object(
    'transferred', v_xferred,
    'remaining_on_vessel', (
      SELECT count(*)::int
      FROM public.material_instances
      WHERE org_id = public.current_org_id()
        AND current_cspo_id = p_cspo_id
        AND sku_id = p_sku_id
        AND status = 'on_vessel'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_return_sku_qty(
  uuid, uuid, uuid, numeric, public.return_item_condition, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.initiate_transfer_sku_qty(
  uuid, uuid, uuid, numeric, text, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
