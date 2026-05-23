-- ============================================================================
-- ShipSync — Procurement workflow fixes
-- Safe to re-run.
-- ============================================================================

-- Allow warehouse roles to create/view procurement requests directly.
DROP POLICY IF EXISTS "procurement_requests_write" ON public.procurement_requests;
CREATE POLICY "procurement_requests_write"
  ON public.procurement_requests FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role(
      'admin', 'pm', 'purchase', 'warehouse_supervisor', 'warehouse_operator'
    )
  )
  WITH CHECK (org_id = public.current_org_id());

CREATE OR REPLACE FUNCTION public.create_procurement_request(
  p_sku_id        uuid,
  p_qty_needed    numeric,
  p_cspo_id       uuid DEFAULT NULL,
  p_list_item_id  uuid DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_requested_by  uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_req_id      uuid;
  v_existing_id uuid;
  v_remaining   numeric;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_list_item_id IS NOT NULL THEN
    SELECT procurement_request_id INTO v_existing_id
    FROM public.material_list_items
    WHERE id = p_list_item_id AND org_id = v_org_id;

    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;

    SELECT GREATEST(requested_qty - packed_qty, 0) INTO v_remaining
    FROM public.material_list_items
    WHERE id = p_list_item_id AND org_id = v_org_id;

    IF v_remaining <= 0 THEN
      RAISE EXCEPTION 'Nothing left to procure on this line item';
    END IF;
  END IF;

  IF p_qty_needed IS NULL OR p_qty_needed <= 0 THEN
    IF v_remaining IS NOT NULL AND v_remaining > 0 THEN
      p_qty_needed := v_remaining;
    ELSE
      RAISE EXCEPTION 'Qty must be positive';
    END IF;
  END IF;

  INSERT INTO public.procurement_requests (
    org_id, cspo_id, sku_id, qty_needed, requested_by, notes
  ) VALUES (
    v_org_id, p_cspo_id, p_sku_id, p_qty_needed, p_requested_by, p_notes
  )
  RETURNING id INTO v_req_id;

  IF p_list_item_id IS NOT NULL THEN
    UPDATE public.material_list_items
    SET procurement_request_id = v_req_id,
        status = 'procuring'::public.material_list_item_status
    WHERE id = p_list_item_id AND org_id = v_org_id;

    UPDATE public.material_lists ml
    SET status = 'awaiting_procurement'::public.material_list_status
    FROM public.material_list_items mli
    WHERE mli.list_id = ml.id AND mli.id = p_list_item_id;
  END IF;

  RETURN v_req_id;
END;
$$;

-- After stock arrives, unblock warehouse packing.
CREATE OR REPLACE FUNCTION public.receive_procurement(
  p_request_id    uuid,
  p_qty_received  numeric,
  p_location_id   uuid DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS void
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

  UPDATE public.procurement_requests
  SET qty_received = qty_received + p_qty_received,
      status = CASE
        WHEN qty_received + p_qty_received >= qty_needed THEN 'received'::public.procurement_status
        ELSE 'partial'::public.procurement_status
      END
  WHERE id = p_request_id;

  SELECT mli.list_id INTO v_list_id
  FROM public.material_list_items mli
  WHERE mli.procurement_request_id = p_request_id
  LIMIT 1;

  IF v_list_id IS NOT NULL THEN
    UPDATE public.material_list_items
    SET status = 'pending'::public.material_list_item_status
    WHERE procurement_request_id = p_request_id
      AND org_id = v_org_id
      AND status = 'procuring'::public.material_list_item_status;

    IF NOT EXISTS (
      SELECT 1 FROM public.material_list_items
      WHERE list_id = v_list_id
        AND status = 'procuring'::public.material_list_item_status
    ) THEN
      UPDATE public.material_lists
      SET status = 'in_packing'::public.material_list_status
      WHERE id = v_list_id AND org_id = v_org_id;
    END IF;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
