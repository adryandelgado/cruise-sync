-- ============================================================================
-- ShipSync — Unblock warehouse when procurement is received
-- Safe to re-run. Run even if 011 was already applied.
-- ============================================================================

DROP FUNCTION IF EXISTS public.receive_procurement(uuid, numeric, uuid, uuid);

CREATE OR REPLACE FUNCTION public.receive_procurement(
  p_request_id    uuid,
  p_qty_received  numeric,
  p_location_id   uuid DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_req      public.procurement_requests%ROWTYPE;
  v_loc_id   uuid;
  v_cost     numeric(12, 2);
  v_list_id  uuid;
  v_new_status public.procurement_status;
  i          int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_qty_received <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  SELECT * INTO v_req
  FROM public.procurement_requests
  WHERE id = p_request_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Procurement request not found'; END IF;

  SELECT default_cost INTO v_cost FROM public.skus WHERE id = v_req.sku_id;

  v_loc_id := p_location_id;
  IF v_loc_id IS NULL THEN
    SELECT id INTO v_loc_id FROM public.locations
    WHERE org_id = v_org_id AND type = 'warehouse'
    LIMIT 1;
  END IF;

  FOR i IN 1 .. p_qty_received::int LOOP
    INSERT INTO public.material_instances (
      org_id, sku_id, status, current_location_id, acquired_cost
    ) VALUES (
      v_org_id, v_req.sku_id, 'in_stock', v_loc_id, v_cost
    );
  END LOOP;

  v_new_status := CASE
    WHEN v_req.qty_received + p_qty_received >= v_req.qty_needed
      THEN 'received'::public.procurement_status
    ELSE 'partial'::public.procurement_status
  END;

  UPDATE public.procurement_requests
  SET qty_received = qty_received + p_qty_received,
      status = v_new_status
  WHERE id = p_request_id;

  SELECT mli.list_id INTO v_list_id
  FROM public.material_list_items mli
  WHERE mli.procurement_request_id = p_request_id
  LIMIT 1;

  IF v_list_id IS NOT NULL THEN
    -- Unblock this line for packing as soon as stock arrives.
    UPDATE public.material_list_items
    SET status = 'pending'::public.material_list_item_status
    WHERE procurement_request_id = p_request_id
      AND org_id = v_org_id
      AND status = 'procuring'::public.material_list_item_status;

    -- Resume warehouse pack job when any lines are ready to pack again.
    IF EXISTS (
      SELECT 1 FROM public.material_list_items
      WHERE list_id = v_list_id
        AND packed_qty < requested_qty
        AND status IN ('pending', 'packed')
    ) THEN
      UPDATE public.material_lists
      SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.material_list_items
          WHERE list_id = v_list_id
            AND status = 'procuring'::public.material_list_item_status
        ) THEN 'partially_packed'::public.material_list_status
        ELSE 'in_packing'::public.material_list_status
      END
      WHERE id = v_list_id
        AND org_id = v_org_id
        AND status IN (
          'awaiting_procurement'::public.material_list_status,
          'submitted'::public.material_list_status,
          'partially_packed'::public.material_list_status
        );
    END IF;
  END IF;

  RETURN json_build_object(
    'request_id', p_request_id,
    'cspo_id', v_req.cspo_id,
    'list_id', v_list_id,
    'procurement_status', v_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_procurement(uuid, numeric, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
