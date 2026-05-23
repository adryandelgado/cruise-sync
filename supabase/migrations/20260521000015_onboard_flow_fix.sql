-- ============================================================================
-- ShipSync — Onboard flow: demo repair + consistent CSPO advance on receive
-- Safe to re-run.
-- ============================================================================

-- After all packages received: in_progress (work started). Use on_vessel when
-- trackable inventory is actually aboard.
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
  v_org_id       uuid;
  v_pkg          public.packages%ROWTYPE;
  v_instance     record;
  v_items_aboard int;
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
  END IF;
END;
$$;

-- Ensure demo CSPO has trackable items (by cspo_number, not fixed UUID).
DO $$
DECLARE
  v_org       uuid := '00000000-fffe-0000-0001-000000000001';
  v_cspo_id   uuid;
  v_vessel    uuid := '00000000-fffe-0000-0003-000000000001';
  v_sku       uuid := '00000000-fffe-0000-0005-000000000001';
  v_profile   uuid;
  v_instance  uuid;
  v_aboard    int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.orgs WHERE id = v_org) THEN
    RETURN;
  END IF;

  SELECT id INTO v_cspo_id
  FROM public.cruise_ship_pos
  WHERE org_id = v_org AND cspo_number = 'DEMO-44521'
  LIMIT 1;

  IF v_cspo_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_aboard
  FROM public.material_instances
  WHERE current_cspo_id = v_cspo_id AND status = 'on_vessel';

  IF v_aboard >= 3 THEN
    RETURN;
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE org_id = v_org LIMIT 1;

  UPDATE public.cruise_ship_pos
  SET status = 'on_vessel'::public.cspo_status,
      actual_start = COALESCE(actual_start, CURRENT_DATE)
  WHERE id = v_cspo_id;

  FOR v_instance IN
    SELECT mi.id
    FROM public.material_instances mi
    WHERE mi.org_id = v_org
      AND mi.sku_id = v_sku
      AND mi.status = 'in_stock'
    ORDER BY mi.created_at
    LIMIT (3 - v_aboard)
  LOOP
    INSERT INTO public.inventory_movements (
      org_id, material_instance_id, to_status, cspo_id, performed_by, notes
    ) VALUES (
      v_org, v_instance, 'on_vessel', v_cspo_id, v_profile, 'Demo: received aboard'
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
