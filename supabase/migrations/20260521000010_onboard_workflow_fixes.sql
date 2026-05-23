-- ============================================================================
-- ShipSync — Onboard workflow fixes + demo CSPO for testing
-- Safe to re-run.
-- ============================================================================

-- Reuse existing draft manifest instead of creating duplicates.
CREATE OR REPLACE FUNCTION public.create_return_manifest(
  p_cspo_id     uuid,
  p_created_by  uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_manifest_id uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_manifest_id
  FROM public.return_manifests
  WHERE cspo_id = p_cspo_id
    AND org_id = v_org_id
    AND status = 'draft'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_manifest_id IS NOT NULL THEN
    RETURN v_manifest_id;
  END IF;

  INSERT INTO public.return_manifests (org_id, cspo_id, created_by)
  VALUES (v_org_id, p_cspo_id, p_created_by)
  RETURNING id INTO v_manifest_id;

  RETURN v_manifest_id;
END;
$$;

-- After all packages received, mark CSPO as on_vessel (not just in_progress).
CREATE OR REPLACE FUNCTION public.receive_package(
  p_package_id   uuid,
  p_notes        text DEFAULT NULL,
  p_received_by  uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id    uuid;
  v_pkg       public.packages%ROWTYPE;
  v_instance  record;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_pkg
  FROM public.packages
  WHERE id = p_package_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found'; END IF;
  IF v_pkg.status NOT IN ('sealed', 'in_transit') THEN
    RAISE EXCEPTION 'Package cannot be received (status: %)', v_pkg.status;
  END IF;

  IF EXISTS (SELECT 1 FROM public.onboard_receipts WHERE package_id = p_package_id) THEN
    RAISE EXCEPTION 'Package already received';
  END IF;

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
    UPDATE public.cruise_ship_pos
    SET status = 'on_vessel',
        actual_start = COALESCE(actual_start, CURRENT_DATE)
    WHERE id = v_pkg.cspo_id;
  END IF;
END;
$$;

-- Demo CSPO with items already aboard (for testing log/returns/closure without full pack flow).
DO $$
DECLARE
  v_org       uuid := '00000000-fffe-0000-0001-000000000001';
  v_cspo_id   uuid := '00000000-fffe-0000-0007-000000000001';
  v_vessel    uuid := '00000000-fffe-0000-0003-000000000001';
  v_sku       uuid := '00000000-fffe-0000-0005-000000000001';
  v_profile   uuid;
  v_instance  uuid;
  v_list_id   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.orgs WHERE id = v_org) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.cruise_ship_pos WHERE id = v_cspo_id) THEN
    RETURN;
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE org_id = v_org LIMIT 1;

  INSERT INTO public.cruise_ship_pos (
    id, org_id, cspo_number, vessel_id, status, attendance_type,
    original_value, currency, port_of_service, assigned_pm, created_by, actual_start
  ) VALUES (
    v_cspo_id, v_org, 'DEMO-44521', v_vessel, 'on_vessel', 'in_drydock',
    2850.00, 'USD', 'Miami, FL', v_profile, v_profile, CURRENT_DATE
  );

  INSERT INTO public.cspo_value_ledger (
    org_id, cspo_id, entry_type, amount, currency, performed_by, notes
  ) VALUES (
    v_org, v_cspo_id, 'initial', 2850.00, 'USD', v_profile, 'Demo CSPO — 3× Petzl ASAP Lock'
  );

  INSERT INTO public.material_lists (org_id, cspo_id, status, submitted_at, submitted_by)
  VALUES (v_org, v_cspo_id, 'complete', now(), v_profile)
  RETURNING id INTO v_list_id;

  INSERT INTO public.material_list_items (
    org_id, list_id, sku_id, requested_qty, packed_qty, status
  ) VALUES (
    v_org, v_list_id, v_sku, 3, 3, 'complete'::public.material_list_item_status
  );

  FOR v_instance IN
    SELECT mi.id
    FROM public.material_instances mi
    WHERE mi.org_id = v_org
      AND mi.sku_id = v_sku
      AND mi.status = 'in_stock'
    ORDER BY mi.created_at
    LIMIT 3
  LOOP
    INSERT INTO public.inventory_movements (
      org_id, material_instance_id, to_status, cspo_id, performed_by, notes
    ) VALUES (
      v_org, v_instance, 'on_vessel', v_cspo_id, v_profile, 'Demo: received aboard'
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
