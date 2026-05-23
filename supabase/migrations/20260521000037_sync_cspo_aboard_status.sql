-- ============================================================================
-- ShipSync — Sync CSPO status when aboard inventory is cleared
-- on_vessel → in_progress once no on_vessel instances remain on the CSPO.
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_cspo_workflow_status(p_cspo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cspo   public.cruise_ship_pos%ROWTYPE;
  v_aboard int;
BEGIN
  IF p_cspo_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_cspo
  FROM public.cruise_ship_pos
  WHERE id = p_cspo_id
    AND org_id = public.current_org_id();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_cspo.status NOT IN ('on_vessel', 'in_progress') THEN
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_aboard
  FROM public.material_instances
  WHERE current_cspo_id = p_cspo_id
    AND status = 'on_vessel'::public.material_status;

  IF v_aboard = 0 AND v_cspo.status = 'on_vessel'::public.cspo_status THEN
    UPDATE public.cruise_ship_pos
    SET status = 'in_progress'::public.cspo_status
    WHERE id = p_cspo_id;
  ELSIF v_aboard > 0 AND v_cspo.status = 'in_progress'::public.cspo_status THEN
    UPDATE public.cruise_ship_pos
    SET status = 'on_vessel'::public.cspo_status
    WHERE id = p_cspo_id;
  END IF;
END;
$$;

-- receive_return_item (036 signature)
CREATE OR REPLACE FUNCTION public.receive_return_item(
  p_instance_id   uuid,
  p_condition     public.return_item_condition DEFAULT 'good',
  p_location_id   uuid DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid(),
  p_manifest_id   uuid DEFAULT NULL
)
RETURNS void
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
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_return_sku_qty(
  p_manifest_id   uuid,
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
  v_org_id    uuid;
  v_cspo_id   uuid;
  v_to_recv   int;
  v_received  int := 0;
  v_instance  uuid;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT cspo_id INTO v_cspo_id
  FROM public.return_manifests
  WHERE id = p_manifest_id
    AND org_id = v_org_id
    AND status IN ('ready', 'picked_up');

  IF v_cspo_id IS NULL THEN
    RAISE EXCEPTION 'Return manifest not open for receipt';
  END IF;

  v_to_recv := FLOOR(p_qty)::int;

  FOR v_instance IN
    SELECT rmi.material_instance_id
    FROM public.return_manifest_items rmi
    JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
    JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
    WHERE rmi.manifest_id = p_manifest_id
      AND mi.sku_id = p_sku_id
      AND mi.status = 'returning'::public.material_status
      AND rmi.received_back_at IS NULL
      AND rm.org_id = v_org_id
      AND rm.status IN ('ready', 'picked_up')
    ORDER BY rmi.created_at
    LIMIT v_to_recv
  LOOP
    PERFORM public.receive_return_item(
      v_instance, p_condition, NULL, p_performed_by, p_manifest_id
    );
    v_received := v_received + 1;
  END LOOP;

  IF v_received = 0 THEN
    RAISE EXCEPTION 'No pending return items for this SKU on the manifest';
  END IF;

  PERFORM public.sync_cspo_workflow_status(v_cspo_id);

  RETURN json_build_object(
    'received', v_received,
    'pending', (
      SELECT count(*)::int
      FROM public.return_manifest_items rmi
      JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
      WHERE rmi.manifest_id = p_manifest_id
        AND mi.sku_id = p_sku_id
        AND rmi.received_back_at IS NULL
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_return_manifest_receipt(
  p_manifest_id   uuid,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id  uuid;
  v_cspo_id uuid;
  v_count   int;
  v_total   int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT cspo_id INTO v_cspo_id
  FROM public.return_manifests
  WHERE id = p_manifest_id AND org_id = v_org_id;

  IF v_cspo_id IS NULL THEN RAISE EXCEPTION 'Return manifest not found'; END IF;

  SELECT count(*) INTO v_total
  FROM public.return_manifest_items
  WHERE manifest_id = p_manifest_id;

  SELECT count(*) INTO v_count
  FROM public.return_manifest_items
  WHERE manifest_id = p_manifest_id AND received_back_at IS NOT NULL;

  IF v_count < v_total THEN
    RAISE EXCEPTION 'Not all items scanned (% / %)', v_count, v_total;
  END IF;

  UPDATE public.return_manifests
  SET status = 'received'
  WHERE id = p_manifest_id AND org_id = v_org_id;

  PERFORM public.sync_cspo_workflow_status(v_cspo_id);
END;
$$;

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
  v_value    numeric(14, 2);
  v_ledger   public.cspo_ledger_entry;
  v_entries  jsonb := '[]'::jsonb;
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

  CASE p_action_type
    WHEN 'consumed' THEN v_ledger := 'consumed';
    WHEN 'installed' THEN v_ledger := 'installed';
    WHEN 'damaged' THEN v_ledger := 'written_off';
  END CASE;

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
    v_value := public.instance_value(v_instance);

    PERFORM public.log_material_usage(
      v_instance,
      p_action_type,
      p_notes,
      p_location,
      p_performed_by
    );

    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'entry_type', v_ledger::text,
        'amount', -v_value
      )
    );

    v_logged := v_logged + 1;
  END LOOP;

  IF v_logged = 0 THEN
    RAISE EXCEPTION 'No on-vessel instances available for this SKU on this CSPO';
  END IF;

  PERFORM public.sync_cspo_workflow_status(p_cspo_id);

  RETURN json_build_object(
    'logged', v_logged,
    'remaining_on_vessel', (
      SELECT count(*)::int
      FROM public.material_instances
      WHERE org_id = v_org_id
        AND current_cspo_id = p_cspo_id
        AND sku_id = p_sku_id
        AND status = 'on_vessel'
    ),
    'ledger_entries', v_entries
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
  v_value   numeric(14, 2);
  v_entries jsonb := '[]'::jsonb;
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

    PERFORM public.initiate_transfer(
      v_instance, p_to_cspo_id, p_notes, p_initiated_by
    );

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
    'ledger_entries', v_entries
  );
END;
$$;

DROP FUNCTION IF EXISTS public.seal_return_manifest(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.seal_return_manifest(
  p_manifest_id   uuid,
  p_freight       text DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_manifest public.return_manifests%ROWTYPE;
  v_item     record;
  v_value    numeric(14, 2);
  v_currency text;
  v_entries  jsonb := '[]'::jsonb;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE id = p_manifest_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Return manifest not found'; END IF;
  IF v_manifest.status <> 'draft' THEN RAISE EXCEPTION 'Manifest already sealed'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.return_manifest_items WHERE manifest_id = p_manifest_id
  ) THEN
    RAISE EXCEPTION 'Add at least one item before sealing';
  END IF;

  SELECT currency INTO v_currency
  FROM public.cruise_ship_pos
  WHERE id = v_manifest.cspo_id;

  FOR v_item IN
    SELECT
      rmi.material_instance_id,
      s.sku_code,
      s.name AS sku_name
    FROM public.return_manifest_items rmi
    JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
    LEFT JOIN public.skus s ON s.id = mi.sku_id
    WHERE rmi.manifest_id = p_manifest_id
  LOOP
    v_value := public.instance_value(v_item.material_instance_id);

    INSERT INTO public.inventory_movements (
      org_id, material_instance_id, to_status,
      cspo_id, performed_by, notes
    ) VALUES (
      v_org_id, v_item.material_instance_id, 'returning',
      NULL, p_performed_by, 'Return manifest sealed'
    );

    INSERT INTO public.cspo_value_ledger (
      org_id, cspo_id, entry_type, amount, currency,
      material_instance_id, performed_by, notes
    ) VALUES (
      v_org_id, v_manifest.cspo_id, 'returned', -v_value, v_currency,
      v_item.material_instance_id, p_performed_by, 'Return manifest sealed'
    );

    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'entry_type', 'returned',
        'amount', -v_value,
        'sku_code', v_item.sku_code,
        'sku_name', v_item.sku_name
      )
    );
  END LOOP;

  UPDATE public.return_manifests
  SET status = 'ready', freight_company = p_freight
  WHERE id = p_manifest_id;

  PERFORM public.sync_cspo_workflow_status(v_manifest.cspo_id);

  RETURN json_build_object(
    'sealed', true,
    'item_count', jsonb_array_length(v_entries),
    'ledger_entries', v_entries
  );
END;
$$;

-- Repair CSPOs stuck on_vessel with nothing aboard.
UPDATE public.cruise_ship_pos c
SET status = 'in_progress'::public.cspo_status
WHERE c.status = 'on_vessel'::public.cspo_status
  AND NOT EXISTS (
    SELECT 1
    FROM public.material_instances mi
    WHERE mi.current_cspo_id = c.id
      AND mi.status = 'on_vessel'::public.material_status
  );

GRANT EXECUTE ON FUNCTION public.sync_cspo_workflow_status(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.receive_return_item(
  uuid, public.return_item_condition, uuid, uuid, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.receive_return_sku_qty(
  uuid, uuid, numeric, public.return_item_condition, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.complete_return_manifest_receipt(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.log_sku_usage_qty(
  uuid, uuid, public.usage_action_type, numeric, text, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.initiate_transfer_sku_qty(
  uuid, uuid, uuid, numeric, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.seal_return_manifest(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
