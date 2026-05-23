-- ============================================================================
-- ShipSync — Onboard Operations (Phase 4)
--
-- PREREQUISITE: 20260521000002_packing.sql (packages table + pack RPCs)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'packages'
  ) THEN
    RAISE EXCEPTION
      'Missing packages — run 20260521000002_packing.sql first, then re-run this file.';
  END IF;
END $$;

CREATE TYPE public.usage_action_type AS ENUM (
  'consumed',
  'installed',
  'damaged',
  'found_extra'
);

CREATE TYPE public.return_manifest_status AS ENUM (
  'draft',
  'ready',
  'picked_up',
  'received'
);

CREATE TYPE public.return_item_condition AS ENUM (
  'good',
  'damaged',
  'needs_inspection'
);

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE public.onboard_receipts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id             uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  package_id          uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  received_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  discrepancy_notes   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id)
);

CREATE INDEX onboard_receipts_cspo_idx ON public.onboard_receipts(cspo_id);

CREATE TABLE public.usage_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id               uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  material_instance_id  uuid NOT NULL REFERENCES public.material_instances(id) ON DELETE RESTRICT,
  action_type           public.usage_action_type NOT NULL,
  qty                   numeric(10, 2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  location_on_vessel    text,
  photo_url             text,
  logged_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  logged_at             timestamptz NOT NULL DEFAULT now(),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_logs_cspo_idx      ON public.usage_logs(cspo_id, logged_at DESC);
CREATE INDEX usage_logs_instance_idx  ON public.usage_logs(material_instance_id);

CREATE TABLE public.transfer_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  from_cspo_id          uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE RESTRICT,
  to_cspo_id            uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE RESTRICT,
  material_instance_id  uuid NOT NULL REFERENCES public.material_instances(id) ON DELETE RESTRICT,
  transferred_value     numeric(14, 2) NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'USD',
  initiated_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  acknowledged_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  initiated_at          timestamptz NOT NULL DEFAULT now(),
  acknowledged_at       timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_distinct_cspos CHECK (from_cspo_id <> to_cspo_id)
);

CREATE INDEX transfer_events_from_idx ON public.transfer_events(from_cspo_id);
CREATE INDEX transfer_events_to_idx   ON public.transfer_events(to_cspo_id);
CREATE INDEX transfer_events_pending_idx
  ON public.transfer_events(to_cspo_id)
  WHERE acknowledged_at IS NULL;

CREATE TABLE public.return_manifests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id           uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  status            public.return_manifest_status NOT NULL DEFAULT 'draft',
  freight_company   text,
  picked_up_at      timestamptz,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX return_manifests_cspo_idx ON public.return_manifests(cspo_id);

CREATE TRIGGER return_manifests_set_updated_at
  BEFORE UPDATE ON public.return_manifests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.return_manifest_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  manifest_id           uuid NOT NULL REFERENCES public.return_manifests(id) ON DELETE CASCADE,
  material_instance_id  uuid NOT NULL REFERENCES public.material_instances(id) ON DELETE RESTRICT,
  condition             public.return_item_condition NOT NULL DEFAULT 'good',
  received_back_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manifest_id, material_instance_id)
);

CREATE INDEX return_manifest_items_manifest_idx ON public.return_manifest_items(manifest_id);

-- Helper: resolve $ value for a material instance.
CREATE OR REPLACE FUNCTION public.instance_value(p_instance_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(mi.acquired_cost, s.default_cost, 0)
  FROM public.material_instances mi
  JOIN public.skus s ON s.id = mi.sku_id
  WHERE mi.id = p_instance_id;
$$;

-- Receive one package aboard: instances packed → on_vessel.
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

  -- Advance CSPO when every package is delivered.
  IF NOT EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.cspo_id = v_pkg.cspo_id
      AND p.status NOT IN ('delivered', 'returned')
  ) THEN
    UPDATE public.cruise_ship_pos
    SET status = 'in_progress',
        actual_start = COALESCE(actual_start, CURRENT_DATE)
    WHERE id = v_pkg.cspo_id;
  END IF;
END;
$$;

-- Log consumption / installation / damage aboard.
CREATE OR REPLACE FUNCTION public.log_material_usage(
  p_instance_id       uuid,
  p_action_type       public.usage_action_type,
  p_notes             text DEFAULT NULL,
  p_location          text DEFAULT NULL,
  p_performed_by      uuid DEFAULT auth.uid()
)
RETURNS void
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
END;
$$;

-- Cross-CSPO transfer: debit source CSPO immediately.
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

  RETURN v_event_id;
END;
$$;

-- Receiving vessel acknowledges transfer: credit target CSPO.
CREATE OR REPLACE FUNCTION public.acknowledge_transfer(
  p_transfer_id      uuid,
  p_acknowledged_by  uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_event    public.transfer_events%ROWTYPE;
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
END;
$$;

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

  INSERT INTO public.return_manifests (org_id, cspo_id, created_by)
  VALUES (v_org_id, p_cspo_id, p_created_by)
  RETURNING id INTO v_manifest_id;

  RETURN v_manifest_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_return_manifest_item(
  p_manifest_id   uuid,
  p_instance_id   uuid,
  p_condition     public.return_item_condition DEFAULT 'good',
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id    uuid;
  v_manifest  public.return_manifests%ROWTYPE;
  v_instance  public.material_instances%ROWTYPE;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE id = p_manifest_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Return manifest not found'; END IF;
  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'Manifest is not editable';
  END IF;

  SELECT * INTO v_instance
  FROM public.material_instances
  WHERE id = p_instance_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Material instance not found'; END IF;
  IF v_instance.status <> 'on_vessel' THEN
    RAISE EXCEPTION 'Only on_vessel items can be returned (current: %)', v_instance.status;
  END IF;
  IF v_instance.current_cspo_id IS DISTINCT FROM v_manifest.cspo_id THEN
    RAISE EXCEPTION 'Instance belongs to a different CSPO';
  END IF;

  INSERT INTO public.return_manifest_items (
    org_id, manifest_id, material_instance_id, condition
  ) VALUES (
    v_org_id, p_manifest_id, p_instance_id, p_condition
  );
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

  FOR v_item IN
    SELECT material_instance_id FROM public.return_manifest_items
    WHERE manifest_id = p_manifest_id
  LOOP
    INSERT INTO public.inventory_movements (
      org_id, material_instance_id, to_status,
      cspo_id, performed_by, notes
    ) VALUES (
      v_org_id, v_item.material_instance_id, 'returning',
      v_manifest.cspo_id, p_performed_by, 'Return manifest sealed'
    );
  END LOOP;

  UPDATE public.return_manifests
  SET status = 'ready', freight_company = p_freight
  WHERE id = p_manifest_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.instance_value(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_package(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_material_usage(uuid, public.usage_action_type, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_transfer(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_return_manifest(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_return_manifest_item(uuid, uuid, public.return_item_condition, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seal_return_manifest(uuid, text, uuid) TO authenticated;

-- RLS
ALTER TABLE public.onboard_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_manifest_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboard_receipts_select"
  ON public.onboard_receipts FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "onboard_receipts_write"
  ON public.onboard_receipts FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'onboard_bookkeeper', 'drydock_bookkeeper')
  )
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "usage_logs_select"
  ON public.usage_logs FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "usage_logs_insert"
  ON public.usage_logs FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'onboard_bookkeeper', 'drydock_bookkeeper')
  );

CREATE POLICY "transfer_events_select"
  ON public.transfer_events FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "transfer_events_write"
  ON public.transfer_events FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'onboard_bookkeeper', 'drydock_bookkeeper')
  )
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "return_manifests_select"
  ON public.return_manifests FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "return_manifests_write"
  ON public.return_manifests FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'onboard_bookkeeper', 'drydock_bookkeeper', 'warehouse_operator')
  )
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "return_manifest_items_select"
  ON public.return_manifest_items FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "return_manifest_items_write"
  ON public.return_manifest_items FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'onboard_bookkeeper', 'drydock_bookkeeper', 'warehouse_operator')
  )
  WITH CHECK (org_id = public.current_org_id());

NOTIFY pgrst, 'reload schema';
