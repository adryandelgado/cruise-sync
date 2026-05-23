-- ============================================================================
-- ShipSync — RPC payloads for client cache patches (procurement, transfer, return)
-- Safe to re-run.
-- ============================================================================

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
  v_org_id        uuid;
  v_req           public.procurement_requests%ROWTYPE;
  v_loc_id        uuid;
  v_cost          numeric(12, 2);
  v_list_id       uuid;
  v_new_status    public.procurement_status;
  i               int;
  v_instance_id   uuid;
  v_instance_ids  uuid[] := '{}';
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
    )
    RETURNING id INTO v_instance_id;

    v_instance_ids := array_append(v_instance_ids, v_instance_id);
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
    UPDATE public.material_list_items
    SET status = 'pending'::public.material_list_item_status
    WHERE procurement_request_id = p_request_id
      AND org_id = v_org_id
      AND status = 'procuring'::public.material_list_item_status;

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
    'procurement_status', v_new_status,
    'sku_id', v_req.sku_id,
    'instances', COALESCE((
      SELECT json_agg(row ORDER BY row->>'created_at' DESC)
      FROM (
        SELECT json_build_object(
          'id', mi.id,
          'status', mi.status,
          'serial_number', mi.serial_number,
          'lot_number', mi.lot_number,
          'acquired_cost', mi.acquired_cost,
          'acquired_at', mi.acquired_at,
          'notes', mi.notes,
          'created_at', mi.created_at,
          'sku_id', mi.sku_id,
          'sku', json_build_object(
            'id', s.id,
            'sku_code', s.sku_code,
            'name', s.name,
            'unit_of_measure', s.unit_of_measure
          ),
          'location', CASE
            WHEN l.id IS NOT NULL THEN json_build_object('name', l.name, 'code', l.code)
            ELSE NULL
          END
        ) AS row
        FROM public.material_instances mi
        JOIN public.skus s ON s.id = mi.sku_id
        LEFT JOIN public.locations l ON l.id = mi.current_location_id
        WHERE mi.id = ANY(v_instance_ids)
      ) sub
    ), '[]'::json)
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
  v_to_xfer    int;
  v_xferred    int := 0;
  v_instance   uuid;
  v_value      numeric(14, 2);
  v_entries    jsonb := '[]'::jsonb;
  v_event_id   uuid;
  v_event_ids  uuid[] := '{}';
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
    v_value := public.instance_value(v_instance);

    v_event_id := public.initiate_transfer(
      v_instance, p_to_cspo_id, p_notes, p_initiated_by
    );
    v_event_ids := array_append(v_event_ids, v_event_id);

    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'entry_type', 'transferred_out',
        'amount', -v_value
      )
    );

    v_xferred := v_xferred + 1;
  END LOOP;

  IF v_xferred = 0 THEN
    RAISE EXCEPTION 'No on-vessel instances available to transfer for this SKU';
  END IF;

  PERFORM public.sync_cspo_workflow_status(p_cspo_id);

  RETURN json_build_object(
    'transferred', v_xferred,
    'remaining_on_vessel', (
      SELECT count(*)::int
      FROM public.material_instances
      WHERE org_id = public.current_org_id()
        AND current_cspo_id = p_cspo_id
        AND sku_id = p_sku_id
        AND status = 'on_vessel'
    ),
    'ledger_entries', v_entries,
    'transfer_rows', COALESCE((
      SELECT json_agg(row ORDER BY row->>'initiated_at' DESC)
      FROM (
        SELECT json_build_object(
          'transfer_id', t.transfer_id,
          'initiated_at', t.initiated_at,
          'acknowledged_at', t.acknowledged_at,
          'transferred_value', t.transferred_value,
          'currency', t.currency,
          'from_cspo', t.from_cspo,
          'to_cspo', t.to_cspo,
          'sku_code', t.sku_code,
          'sku_name', t.sku_name
        ) AS row
        FROM public.transfer_audit t
        WHERE t.transfer_id = ANY(v_event_ids)
      ) sub
    ), '[]'::json)
  );
END;
$$;

-- Return type changes void → json; must drop first.
DROP FUNCTION IF EXISTS public.receive_return_item(
  uuid, public.return_item_condition, uuid, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.receive_return_item(
  p_instance_id   uuid,
  p_condition     public.return_item_condition DEFAULT 'good',
  p_location_id   uuid DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid(),
  p_manifest_id   uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id     uuid;
  v_instance   public.material_instances%ROWTYPE;
  v_item       public.return_manifest_items%ROWTYPE;
  v_manifest   public.return_manifests%ROWTYPE;
  v_loc_id     uuid;
  v_to_status  public.material_status;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_instance
  FROM public.material_instances
  WHERE id = p_instance_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Instance not found'; END IF;
  IF v_instance.status <> 'returning' THEN
    RAISE EXCEPTION 'Instance must be returning (current: %)', v_instance.status;
  END IF;

  SELECT rmi.*
  INTO v_item
  FROM public.return_manifest_items rmi
  JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
  WHERE rmi.material_instance_id = p_instance_id
    AND rmi.org_id = v_org_id
    AND rm.status IN ('ready', 'picked_up')
    AND rmi.received_back_at IS NULL
    AND (p_manifest_id IS NULL OR rmi.manifest_id = p_manifest_id)
  ORDER BY rm.created_at DESC, rmi.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Return manifest not open for receipt'; END IF;

  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE id = v_item.manifest_id
    AND org_id = v_org_id
    AND status IN ('ready', 'picked_up');

  IF NOT FOUND THEN RAISE EXCEPTION 'Return manifest not open for receipt'; END IF;

  v_loc_id := p_location_id;
  IF v_loc_id IS NULL THEN
    SELECT id INTO v_loc_id FROM public.locations
    WHERE org_id = v_org_id AND type = 'warehouse' LIMIT 1;
  END IF;

  v_to_status := CASE p_condition
    WHEN 'damaged' THEN 'damaged'::public.material_status
    WHEN 'needs_inspection' THEN 'inspecting'::public.material_status
    ELSE 'in_stock'::public.material_status
  END;

  INSERT INTO public.inventory_movements (
    org_id, material_instance_id, to_status,
    to_location_id, cspo_id, performed_by, notes, reason_code
  ) VALUES (
    v_org_id, p_instance_id, v_to_status,
    v_loc_id, v_manifest.cspo_id, p_performed_by,
    'Return received at warehouse', p_condition::text
  );

  UPDATE public.material_instances
  SET current_cspo_id = NULL, current_package_id = NULL
  WHERE id = p_instance_id;

  UPDATE public.return_manifest_items
  SET received_back_at = now(), condition = p_condition
  WHERE id = v_item.id;

  PERFORM public.sync_cspo_workflow_status(v_manifest.cspo_id);

  RETURN json_build_object(
    'instance_id', p_instance_id,
    'sku_id', v_instance.sku_id,
    'to_status', v_to_status::text
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_procurement(uuid, numeric, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_transfer_sku_qty(uuid, uuid, uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_return_item(uuid, public.return_item_condition, uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
