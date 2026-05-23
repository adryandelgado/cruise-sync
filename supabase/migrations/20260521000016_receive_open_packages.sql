-- ============================================================================
-- ShipSync — Receive open (supplemental) packages that were packed but not sealed
-- Safe to re-run.
-- ============================================================================

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
  v_has_contents boolean;
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

NOTIFY pgrst, 'reload schema';
