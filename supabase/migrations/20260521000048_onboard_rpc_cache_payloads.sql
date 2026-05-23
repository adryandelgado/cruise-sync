-- ============================================================================
-- ShipSync — Onboard RPC cache payloads (usage, transfer, acknowledge)
-- Safe to re-run. Return-type changes require DROP first.
-- ============================================================================

DROP FUNCTION IF EXISTS public.log_material_usage(
  uuid, public.usage_action_type, text, text, uuid
);

CREATE OR REPLACE FUNCTION public.log_material_usage(
  p_instance_id       uuid,
  p_action_type       public.usage_action_type,
  p_notes             text DEFAULT NULL,
  p_location          text DEFAULT NULL,
  p_performed_by      uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id    uuid;
  v_instance  public.material_instances%ROWTYPE;
  v_value     numeric(14, 2);
  v_cspo_id   uuid;
  v_to_status public.material_status;
  v_ledger    public.cspo_ledger_entry;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_instance
  FROM public.material_instances
  WHERE id = p_instance_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Material instance not found'; END IF;
  IF v_instance.status <> 'on_vessel' THEN
    RAISE EXCEPTION 'Instance must be on_vessel (current: %)', v_instance.status;
  END IF;

  v_cspo_id := v_instance.current_cspo_id;
  IF v_cspo_id IS NULL THEN RAISE EXCEPTION 'Instance has no CSPO attribution'; END IF;

  v_value := public.instance_value(p_instance_id);

  CASE p_action_type
    WHEN 'consumed' THEN
      v_to_status := 'consumed';
      v_ledger := 'consumed';
    WHEN 'installed' THEN
      v_to_status := 'installed';
      v_ledger := 'installed';
    WHEN 'damaged' THEN
      v_to_status := 'damaged';
      v_ledger := 'written_off';
    ELSE
      RAISE EXCEPTION 'Action % does not change instance state', p_action_type;
  END CASE;

  INSERT INTO public.inventory_movements (
    org_id, material_instance_id, to_status,
    cspo_id, performed_by, notes, reason_code
  ) VALUES (
    v_org_id, p_instance_id, v_to_status,
    v_cspo_id, p_performed_by, p_notes, p_action_type::text
  );

  IF p_action_type IN ('consumed', 'installed', 'damaged') THEN
    INSERT INTO public.cspo_value_ledger (
      org_id, cspo_id, entry_type, amount, currency,
      material_instance_id, performed_by, notes
    )
    SELECT
      v_org_id, v_cspo_id, v_ledger, -v_value, c.currency,
      p_instance_id, p_performed_by, p_notes
    FROM public.cruise_ship_pos c
    WHERE c.id = v_cspo_id;
  END IF;

  INSERT INTO public.usage_logs (
    org_id, cspo_id, material_instance_id, action_type,
    location_on_vessel, logged_by, notes
  ) VALUES (
    v_org_id, v_cspo_id, p_instance_id, p_action_type,
    p_location, p_performed_by, p_notes
  );

  PERFORM public.sync_cspo_workflow_status(v_cspo_id);

  RETURN json_build_object(
    'cspo_id', v_cspo_id,
    'sku_id', v_instance.sku_id,
    'sku_code', (SELECT s.sku_code FROM public.skus s WHERE s.id = v_instance.sku_id),
    'sku_name', (SELECT s.name FROM public.skus s WHERE s.id = v_instance.sku_id),
    'remaining_on_vessel', (
      SELECT count(*)::int
      FROM public.material_instances
      WHERE org_id = v_org_id
        AND current_cspo_id = v_cspo_id
        AND sku_id = v_instance.sku_id
        AND status = 'on_vessel'
    ),
    'ledger_entries', jsonb_build_array(
      jsonb_build_object(
        'entry_type', v_ledger::text,
        'amount', -v_value
      )
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS public.initiate_transfer(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.initiate_transfer(
  p_instance_id   uuid,
  p_to_cspo_id    uuid,
  p_notes         text DEFAULT NULL,
  p_initiated_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_instance    public.material_instances%ROWTYPE;
  v_from_cspo   uuid;
  v_value       numeric(14, 2);
  v_currency    text;
  v_event_id    uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_instance
  FROM public.material_instances
  WHERE id = p_instance_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Material instance not found'; END IF;
  IF v_instance.status <> 'on_vessel' THEN
    RAISE EXCEPTION 'Only on_vessel items can transfer (current: %)', v_instance.status;
  END IF;

  v_from_cspo := v_instance.current_cspo_id;
  IF v_from_cspo IS NULL THEN RAISE EXCEPTION 'Instance has no source CSPO'; END IF;
  IF v_from_cspo = p_to_cspo_id THEN RAISE EXCEPTION 'Cannot transfer to the same CSPO'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_to_cspo_id AND org_id = v_org_id
      AND status NOT IN ('closed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Target CSPO not found or not open';
  END IF;

  v_value := public.instance_value(p_instance_id);

  SELECT currency INTO v_currency
  FROM public.cruise_ship_pos WHERE id = v_from_cspo;

  INSERT INTO public.transfer_events (
    org_id, from_cspo_id, to_cspo_id, material_instance_id,
    transferred_value, currency, initiated_by, notes
  ) VALUES (
    v_org_id, v_from_cspo, p_to_cspo_id, p_instance_id,
    v_value, v_currency, p_initiated_by, p_notes
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.inventory_movements (
    org_id, material_instance_id, to_status,
    cspo_id, performed_by, notes
  ) VALUES (
    v_org_id, p_instance_id, 'transferring',
    v_from_cspo, p_initiated_by, 'Transfer to CSPO ' || p_to_cspo_id::text
  );

  INSERT INTO public.cspo_value_ledger (
    org_id, cspo_id, entry_type, amount, currency,
    material_instance_id, related_event_id, performed_by, notes
  ) VALUES (
    v_org_id, v_from_cspo, 'transferred_out', -v_value, v_currency,
    p_instance_id, v_event_id, p_initiated_by, p_notes
  );

  PERFORM public.sync_cspo_workflow_status(v_from_cspo);

  RETURN json_build_object(
    'event_id', v_event_id,
    'from_cspo_id', v_from_cspo,
    'to_cspo_id', p_to_cspo_id,
    'transferred_value', v_value,
    'currency', v_currency,
    'sku_code', (SELECT s.sku_code FROM public.skus s WHERE s.id = v_instance.sku_id),
    'sku_name', (SELECT s.name FROM public.skus s WHERE s.id = v_instance.sku_id),
    'ledger_entries', jsonb_build_array(
      jsonb_build_object(
        'entry_type', 'transferred_out',
        'amount', -v_value
      )
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
  v_to_xfer    int;
  v_xferred    int := 0;
  v_instance   uuid;
  v_value      numeric(14, 2);
  v_entries    jsonb := '[]'::jsonb;
  v_xfer       json;
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

    v_xfer := public.initiate_transfer(
      v_instance, p_to_cspo_id, p_notes, p_initiated_by
    );
    v_event_id := (v_xfer->>'event_id')::uuid;
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

DROP FUNCTION IF EXISTS public.acknowledge_transfer(uuid, uuid);

CREATE OR REPLACE FUNCTION public.acknowledge_transfer(
  p_transfer_id      uuid,
  p_acknowledged_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_event    public.transfer_events%ROWTYPE;
  v_sku_id   uuid;
  v_sku_code text;
  v_sku_name text;
  v_uom      text;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_event
  FROM public.transfer_events
  WHERE id = p_transfer_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer event not found'; END IF;
  IF v_event.acknowledged_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transfer already acknowledged';
  END IF;

  INSERT INTO public.inventory_movements (
    org_id, material_instance_id, to_status,
    cspo_id, performed_by, notes
  ) VALUES (
    v_org_id, v_event.material_instance_id, 'on_vessel',
    v_event.to_cspo_id, p_acknowledged_by,
    'Transfer acknowledged from CSPO ' || v_event.from_cspo_id::text
  );

  INSERT INTO public.cspo_value_ledger (
    org_id, cspo_id, entry_type, amount, currency,
    material_instance_id, related_event_id, performed_by, notes
  ) VALUES (
    v_org_id, v_event.to_cspo_id, 'transferred_in', v_event.transferred_value,
    v_event.currency, v_event.material_instance_id, p_transfer_id,
    p_acknowledged_by, v_event.notes
  );

  UPDATE public.transfer_events
  SET acknowledged_by = p_acknowledged_by,
      acknowledged_at = now()
  WHERE id = p_transfer_id;

  SELECT s.id, s.sku_code, s.name, s.unit_of_measure
  INTO v_sku_id, v_sku_code, v_sku_name, v_uom
  FROM public.material_instances mi
  JOIN public.skus s ON s.id = mi.sku_id
  WHERE mi.id = v_event.material_instance_id;

  PERFORM public.sync_cspo_workflow_status(v_event.to_cspo_id);

  RETURN json_build_object(
    'transfer_id', p_transfer_id,
    'from_cspo_id', v_event.from_cspo_id,
    'to_cspo_id', v_event.to_cspo_id,
    'transferred_value', v_event.transferred_value,
    'currency', v_event.currency,
    'sku_id', v_sku_id,
    'sku_code', v_sku_code,
    'sku_name', v_sku_name,
    'unit_of_measure', v_uom,
    'remaining_on_vessel', (
      SELECT count(*)::int
      FROM public.material_instances
      WHERE org_id = v_org_id
        AND current_cspo_id = v_event.to_cspo_id
        AND sku_id = v_sku_id
        AND status = 'on_vessel'
    ),
    'ledger_entries', jsonb_build_array(
      jsonb_build_object(
        'entry_type', 'transferred_in',
        'amount', v_event.transferred_value
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_material_usage(uuid, public.usage_action_type, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_transfer(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_transfer_sku_qty(uuid, uuid, uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_transfer(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
