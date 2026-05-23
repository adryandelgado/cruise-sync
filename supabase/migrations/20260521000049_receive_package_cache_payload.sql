-- ============================================================================
-- ShipSync — receive_package cache payload + initiate_transfer sku context
-- Safe to re-run. receive_package return type changes void → json (DROP first).
-- ============================================================================

DROP FUNCTION IF EXISTS public.receive_package(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.receive_package(
  p_package_id   uuid,
  p_notes        text DEFAULT NULL,
  p_received_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id              uuid;
  v_pkg                 public.packages%ROWTYPE;
  v_instance            record;
  v_items_aboard        int;
  v_has_contents        boolean;
  v_trackable_added     int := 0;
  v_all_received        boolean := false;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_pkg
  FROM public.packages
  WHERE id = p_package_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found'; END IF;

  IF EXISTS (SELECT 1 FROM public.onboard_receipts WHERE package_id = p_package_id) THEN
    RAISE EXCEPTION 'Package already received';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.package_contents pc WHERE pc.package_id = p_package_id
  ) INTO v_has_contents;

  IF v_pkg.status = 'open'::public.package_status THEN
    IF NOT v_has_contents THEN
      RAISE EXCEPTION
        'Package is still open and empty — pack items at warehouse first';
    END IF;
    UPDATE public.packages
    SET status = 'sealed',
        packed_at = COALESCE(packed_at, now()),
        packed_by = COALESCE(packed_by, p_received_by)
    WHERE id = p_package_id;
    v_pkg.status := 'sealed';
  END IF;

  IF v_pkg.status NOT IN ('sealed', 'in_transit') THEN
    RAISE EXCEPTION 'Package cannot be received (status: %)', v_pkg.status;
  END IF;

  SELECT count(*)::int INTO v_trackable_added
  FROM public.package_contents pc
  WHERE pc.package_id = p_package_id
    AND pc.material_instance_id IS NOT NULL;

  FOR v_instance IN
    SELECT pc.material_instance_id AS id
    FROM public.package_contents pc
    WHERE pc.package_id = p_package_id
      AND pc.material_instance_id IS NOT NULL
  LOOP
    INSERT INTO public.inventory_movements (
      org_id, material_instance_id, to_status,
      cspo_id, package_id, performed_by, notes
    ) VALUES (
      v_org_id, v_instance.id, 'on_vessel',
      v_pkg.cspo_id, p_package_id, p_received_by,
      'Received aboard'
    );
  END LOOP;

  UPDATE public.packages
  SET status = 'delivered'
  WHERE id = p_package_id;

  INSERT INTO public.onboard_receipts (
    org_id, cspo_id, package_id, received_by, discrepancy_notes
  ) VALUES (
    v_org_id, v_pkg.cspo_id, p_package_id, p_received_by, p_notes
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.cspo_id = v_pkg.cspo_id
      AND p.status NOT IN ('delivered', 'returned')
  ) THEN
    SELECT count(*) INTO v_items_aboard
    FROM public.material_instances mi
    WHERE mi.current_cspo_id = v_pkg.cspo_id
      AND mi.status = 'on_vessel';

    UPDATE public.cruise_ship_pos
    SET status = CASE
      WHEN v_items_aboard > 0 THEN 'on_vessel'::public.cspo_status
      ELSE 'in_progress'::public.cspo_status
    END,
    actual_start = COALESCE(actual_start, CURRENT_DATE)
    WHERE id = v_pkg.cspo_id;

    v_all_received := true;
  END IF;

  SELECT count(*)::int INTO v_items_aboard
  FROM public.material_instances mi
  WHERE mi.org_id = v_org_id
    AND mi.current_cspo_id = v_pkg.cspo_id
    AND mi.status = 'on_vessel';

  RETURN json_build_object(
    'cspo_id', v_pkg.cspo_id,
    'package_id', p_package_id,
    'trackable_added', v_trackable_added,
    'items_on_vessel', v_items_aboard,
    'all_packages_received', v_all_received,
    'inventory_deltas', COALESCE((
      SELECT json_agg(row ORDER BY row->>'name')
      FROM (
        SELECT json_build_object(
          'sku_id', s.id,
          'sku_code', s.sku_code,
          'name', s.name,
          'unit_of_measure', s.unit_of_measure,
          'qty_added', count(*)::int
        ) AS row
        FROM public.package_contents pc
        JOIN public.material_instances mi ON mi.id = pc.material_instance_id
        JOIN public.skus s ON s.id = mi.sku_id
        WHERE pc.package_id = p_package_id
          AND pc.material_instance_id IS NOT NULL
        GROUP BY s.id, s.sku_code, s.name, s.unit_of_measure
      ) sub
    ), '[]'::json)
  );
END;
$$;

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
    'sku_id', v_instance.sku_id,
    'transferred_value', v_value,
    'currency', v_currency,
    'sku_code', (SELECT s.sku_code FROM public.skus s WHERE s.id = v_instance.sku_id),
    'sku_name', (SELECT s.name FROM public.skus s WHERE s.id = v_instance.sku_id),
    'remaining_on_vessel', (
      SELECT count(*)::int
      FROM public.material_instances
      WHERE org_id = v_org_id
        AND current_cspo_id = v_from_cspo
        AND sku_id = v_instance.sku_id
        AND status = 'on_vessel'
    ),
    'ledger_entries', jsonb_build_array(
      jsonb_build_object(
        'entry_type', 'transferred_out',
        'amount', -v_value
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_package(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_transfer(uuid, uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
