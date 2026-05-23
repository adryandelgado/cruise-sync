-- ============================================================================
-- ShipSync — Return ledger amounts from bulk onboard RPCs (optimistic UI)
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

  RETURN json_build_object(
    'sealed', true,
    'item_count', jsonb_array_length(v_entries),
    'ledger_entries', v_entries
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_sku_usage_qty(
  uuid, uuid, public.usage_action_type, numeric, text, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.initiate_transfer_sku_qty(
  uuid, uuid, uuid, numeric, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.seal_return_manifest(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
