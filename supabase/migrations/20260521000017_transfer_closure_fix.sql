-- ============================================================================
-- ShipSync — Transfer custody fix: detach source CSPO so closure works
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
          'transferring'::public.material_status
        ) THEN NULL
        ELSE COALESCE(NEW.cspo_id, current_cspo_id)
      END,
      current_package_id  = CASE
        WHEN NEW.to_status IN (
          'in_stock'::public.material_status,
          'transferring'::public.material_status
        ) THEN NULL
        ELSE COALESCE(NEW.package_id, current_package_id)
      END
  WHERE id = NEW.material_instance_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.initiate_transfer(
  p_instance_id   uuid,
  p_to_cspo_id    uuid,
  p_notes         text DEFAULT NULL,
  p_initiated_by  uuid DEFAULT auth.uid()
)
RETURNS uuid
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

  -- Custody leaves source CSPO immediately; target CSPO claims on acknowledge.
  INSERT INTO public.inventory_movements (
    org_id, material_instance_id, to_status,
    cspo_id, performed_by, notes
  ) VALUES (
    v_org_id, p_instance_id, 'transferring',
    NULL, p_initiated_by,
    'Transfer to CSPO ' || p_to_cspo_id::text
  );

  INSERT INTO public.cspo_value_ledger (
    org_id, cspo_id, entry_type, amount, currency,
    material_instance_id, related_event_id, performed_by, notes
  ) VALUES (
    v_org_id, v_from_cspo, 'transferred_out', -v_value, v_currency,
    p_instance_id, v_event_id, p_initiated_by, p_notes
  );

  RETURN v_event_id;
END;
$$;

-- Repair instances stuck on source CSPO after outbound transfer.
UPDATE public.material_instances mi
SET current_cspo_id = NULL,
    current_package_id = NULL
FROM public.transfer_events te
WHERE te.material_instance_id = mi.id
  AND te.from_cspo_id = mi.current_cspo_id
  AND mi.status = 'transferring'::public.material_status
  AND te.acknowledged_at IS NULL;

UPDATE public.material_instances mi
SET current_cspo_id = te.to_cspo_id,
    status = 'on_vessel'::public.material_status
FROM public.transfer_events te
WHERE te.material_instance_id = mi.id
  AND te.acknowledged_at IS NOT NULL
  AND mi.current_cspo_id = te.from_cspo_id
  AND mi.status IN (
    'transferring'::public.material_status,
    'on_vessel'::public.material_status
  );

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

  SELECT count(*) INTO v_open
  FROM public.material_instances mi
  WHERE mi.current_cspo_id = p_cspo_id
    AND mi.status IN ('on_vessel', 'packed', 'in_transit', 'allocated',
                      'returning', 'transferring');

  IF v_open > 0 THEN
    SELECT string_agg(lbl, ', ' ORDER BY lbl) INTO v_detail
    FROM (
      SELECT mi.status::text || ' ×' || count(*)::text AS lbl
      FROM public.material_instances mi
      WHERE mi.current_cspo_id = p_cspo_id
        AND mi.status IN ('on_vessel', 'packed', 'in_transit', 'allocated',
                          'returning', 'transferring')
      GROUP BY mi.status
    ) breakdown;

    RAISE EXCEPTION
      '% material instance(s) still on this CSPO (%). Transfer, return, or log usage on each before closing.',
      v_open, COALESCE(v_detail, 'see onboard inventory');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transfer_events
    WHERE from_cspo_id = p_cspo_id
      AND acknowledged_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Outbound transfers awaiting acknowledgement on the receiving CSPO — open that job and acknowledge first';
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
    WHERE cspo_id = p_cspo_id AND status IN ('draft', 'ready', 'picked_up')
  ) THEN
    RAISE EXCEPTION 'Open return manifests must be completed first';
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

NOTIFY pgrst, 'reload schema';
