-- ============================================================================
-- ShipSync — Return manifest closure fix
-- Returning items leave CSPO custody on seal; ledger credits on seal.
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_material_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.material_instances
  SET status              = NEW.to_status,
      current_location_id = NEW.to_location_id,
      current_cspo_id     = CASE
        WHEN NEW.to_status IN (
          'in_stock'::public.material_status,
          'transferring'::public.material_status,
          'returning'::public.material_status
        ) THEN NULL
        ELSE COALESCE(NEW.cspo_id, current_cspo_id)
      END,
      current_package_id  = CASE
        WHEN NEW.to_status IN (
          'in_stock'::public.material_status,
          'transferring'::public.material_status,
          'returning'::public.material_status
        ) THEN NULL
        ELSE COALESCE(NEW.package_id, current_package_id)
      END
  WHERE id = NEW.material_instance_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.seal_return_manifest(
  p_manifest_id   uuid,
  p_freight       text DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS void
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
    SELECT material_instance_id FROM public.return_manifest_items
    WHERE manifest_id = p_manifest_id
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
  END LOOP;

  UPDATE public.return_manifests
  SET status = 'ready', freight_company = p_freight
  WHERE id = p_manifest_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_return_item(
  p_instance_id   uuid,
  p_condition     public.return_item_condition DEFAULT 'good',
  p_location_id   uuid DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
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

  SELECT * INTO v_item
  FROM public.return_manifest_items rmi
  WHERE rmi.material_instance_id = p_instance_id
    AND rmi.org_id = v_org_id
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Instance not on a return manifest'; END IF;

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
    v_loc_id, NULL, p_performed_by,
    'Return received at warehouse', p_condition::text
  );

  UPDATE public.return_manifest_items
  SET received_back_at = now(), condition = p_condition
  WHERE id = v_item.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cspo(
  p_cspo_id       uuid,
  p_closure_notes text DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_cspo     public.cruise_ship_pos%ROWTYPE;
  v_open     int;
  v_summary  record;
  v_detail   text;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_cspo
  FROM public.cruise_ship_pos
  WHERE id = p_cspo_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'CSPO not found'; END IF;
  IF v_cspo.status = 'closed' THEN RAISE EXCEPTION 'CSPO already closed'; END IF;

  -- Only aboard / packed inventory blocks closure (not in-transit returns or transfers).
  SELECT count(*) INTO v_open
  FROM public.material_instances mi
  WHERE mi.current_cspo_id = p_cspo_id
    AND mi.status IN ('on_vessel', 'packed', 'in_transit', 'allocated');

  IF v_open > 0 THEN
    SELECT string_agg(lbl, ', ' ORDER BY lbl) INTO v_detail
    FROM (
      SELECT mi.status::text || ' ×' || count(*)::text AS lbl
      FROM public.material_instances mi
      WHERE mi.current_cspo_id = p_cspo_id
        AND mi.status IN ('on_vessel', 'packed', 'in_transit', 'allocated')
      GROUP BY mi.status
    ) breakdown;

    RAISE EXCEPTION
      '% item(s) still aboard or packed on this CSPO (%). Return, transfer, or log usage on each before closing.',
      v_open, COALESCE(v_detail, 'see onboard inventory');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transfer_events
    WHERE from_cspo_id = p_cspo_id
      AND acknowledged_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Outbound transfers awaiting acknowledgement on the receiving CSPO — acknowledge there first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transfer_events
    WHERE to_cspo_id = p_cspo_id
      AND acknowledged_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Inbound transfers must be acknowledged before closing this CSPO';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.return_manifests
    WHERE cspo_id = p_cspo_id AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Seal or remove draft return manifest before closing';
  END IF;

  UPDATE public.cruise_ship_pos
  SET status = 'closed',
      actual_end = COALESCE(actual_end, CURRENT_DATE),
      closure_notes = COALESCE(p_closure_notes, closure_notes)
  WHERE id = p_cspo_id;

  SELECT * INTO v_summary FROM public.cspo_closure_report WHERE cspo_id = p_cspo_id;

  RETURN json_build_object(
    'cspo_id', p_cspo_id,
    'cspo_number', v_cspo.cspo_number,
    'original_value', v_summary.original_value,
    'open_balance', v_summary.open_balance,
    'variance_pct', v_summary.variance_pct,
    'closed_at', now()
  );
END;
$$;

-- Detach returning items already sealed on a manifest.
UPDATE public.material_instances mi
SET current_cspo_id = NULL,
    current_package_id = NULL
WHERE mi.status = 'returning'::public.material_status
  AND mi.current_cspo_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.return_manifest_items rmi
    JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
    WHERE rmi.material_instance_id = mi.id
      AND rm.status IN ('ready', 'picked_up', 'received')
  );

-- Ledger credit for returns sealed before this migration (skip if already recorded).
INSERT INTO public.cspo_value_ledger (
  org_id, cspo_id, entry_type, amount, currency,
  material_instance_id, performed_by, notes
)
SELECT
  rm.org_id,
  rm.cspo_id,
  'returned'::public.cspo_ledger_entry,
  -public.instance_value(rmi.material_instance_id),
  c.currency,
  rmi.material_instance_id,
  rm.created_by,
  'Backfill: return manifest sealed'
FROM public.return_manifest_items rmi
JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
JOIN public.cruise_ship_pos c ON c.id = rm.cspo_id
WHERE rm.status IN ('ready', 'picked_up', 'received')
  AND NOT EXISTS (
    SELECT 1
    FROM public.cspo_value_ledger l
    WHERE l.material_instance_id = rmi.material_instance_id
      AND l.entry_type = 'returned'::public.cspo_ledger_entry
      AND l.cspo_id = rm.cspo_id
  );

NOTIFY pgrst, 'reload schema';
