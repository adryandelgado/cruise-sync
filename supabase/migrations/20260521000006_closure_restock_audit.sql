-- ============================================================================
-- ShipSync — Closure, Restock, Audit & Reports (Phase 5–6)
-- PREREQUISITE: 20260521000004_onboard_operations.sql
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'return_manifests'
  ) THEN
    RAISE EXCEPTION
      'Missing return_manifests — run 20260521000004_onboard_operations.sql first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- AUDIT LOG (blueprint §13)
-- ----------------------------------------------------------------------------
CREATE TABLE public.audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  old_data    jsonb,
  new_data    jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_org_idx     ON public.audit_events(org_id, occurred_at DESC);
CREATE INDEX audit_events_table_idx   ON public.audit_events(table_name, record_id);

CREATE OR REPLACE FUNCTION public.audit_financial_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_events (
    org_id, table_name, record_id, action, actor_id, old_data, new_data
  ) VALUES (
    COALESCE(NEW.org_id, OLD.org_id),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_cspos
  AFTER INSERT OR UPDATE OR DELETE ON public.cruise_ship_pos
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_change();

CREATE TRIGGER audit_transfer_events
  AFTER INSERT OR UPDATE ON public.transfer_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_change();

CREATE TRIGGER audit_cspo_ledger
  AFTER INSERT ON public.cspo_value_ledger
  FOR EACH ROW EXECUTE FUNCTION public.audit_financial_change();

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_events_select"
  ON public.audit_events FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm'));

-- ----------------------------------------------------------------------------
-- RESTOCK: warehouse receives return manifest items
-- ----------------------------------------------------------------------------
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
  v_value      numeric(14, 2);
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
    v_loc_id, v_manifest.cspo_id, p_performed_by,
    'Return received at warehouse', p_condition::text
  );

  UPDATE public.material_instances
  SET current_cspo_id = NULL, current_package_id = NULL
  WHERE id = p_instance_id;

  UPDATE public.return_manifest_items
  SET received_back_at = now(), condition = p_condition
  WHERE id = v_item.id;

  IF v_to_status = 'in_stock' THEN
    v_value := public.instance_value(p_instance_id);
    INSERT INTO public.cspo_value_ledger (
      org_id, cspo_id, entry_type, amount, currency,
      material_instance_id, performed_by, notes
    )
    SELECT
      v_org_id, v_manifest.cspo_id, 'returned', -v_value, c.currency,
      p_instance_id, p_performed_by, 'Returned to warehouse'
    FROM public.cruise_ship_pos c WHERE c.id = v_manifest.cspo_id;
  END IF;
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
  v_org_id uuid;
  v_count  int;
  v_total  int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

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
END;
$$;

-- ----------------------------------------------------------------------------
-- CSPO CLOSURE (blueprint Phase 13)
-- ----------------------------------------------------------------------------
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
  FROM public.material_instances
  WHERE current_cspo_id = p_cspo_id
    AND status IN ('on_vessel', 'packed', 'in_transit', 'allocated',
                   'returning', 'transferring');

  IF v_open > 0 THEN
    RAISE EXCEPTION '% material instance(s) still unresolved aboard/in transit', v_open;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transfer_events
    WHERE (from_cspo_id = p_cspo_id OR to_cspo_id = p_cspo_id)
      AND acknowledged_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Pending transfer events must be acknowledged first';
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

GRANT EXECUTE ON FUNCTION public.receive_return_item(uuid, public.return_item_condition, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_return_manifest_receipt(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cspo(uuid, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- REPORT VIEWS (blueprint §11)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cspo_closure_report AS
SELECT
  c.id AS cspo_id,
  c.org_id,
  c.cspo_number,
  c.status,
  c.original_value,
  c.currency,
  s.consumed_value,
  s.installed_value,
  s.returned_value,
  s.transferred_out_value,
  s.transferred_in_value,
  s.written_off_value,
  s.open_balance,
  (s.consumed_value + s.installed_value + s.returned_value
   + s.transferred_out_value + s.written_off_value) AS reconciled_out,
  CASE WHEN c.original_value > 0 THEN
    round((s.open_balance / c.original_value * 100)::numeric, 2)
  ELSE 0 END AS variance_pct,
  (
    SELECT count(*) FROM public.material_instances mi
    WHERE mi.current_cspo_id = c.id AND mi.status = 'on_vessel'
  ) AS items_still_aboard
FROM public.cruise_ship_pos c
JOIN public.cspo_live_summary s ON s.cspo_id = c.id;

CREATE OR REPLACE VIEW public.warehouse_load AS
SELECT
  ml.org_id,
  count(*) FILTER (WHERE ml.status IN ('submitted', 'in_packing')) AS open_pack_jobs,
  count(*) FILTER (WHERE ml.status = 'awaiting_procurement') AS awaiting_procurement,
  (
    SELECT count(*) FROM public.return_manifests rm
    WHERE rm.org_id = ml.org_id AND rm.status IN ('ready', 'picked_up')
  ) AS returning_shipments,
  (
    SELECT count(*) FROM public.procurement_requests pr
    WHERE pr.org_id = ml.org_id AND pr.status IN ('open', 'partial')
  ) AS open_procurement
FROM public.material_lists ml
GROUP BY ml.org_id;

CREATE OR REPLACE VIEW public.transfer_audit AS
SELECT
  t.id AS transfer_id,
  t.org_id,
  t.initiated_at,
  t.acknowledged_at,
  t.transferred_value,
  t.currency,
  t.notes,
  fc.cspo_number AS from_cspo,
  tc.cspo_number AS to_cspo,
  s.sku_code,
  s.name AS sku_name,
  mi.serial_number,
  p1.full_name AS initiated_by_name,
  p2.full_name AS acknowledged_by_name
FROM public.transfer_events t
JOIN public.cruise_ship_pos fc ON fc.id = t.from_cspo_id
JOIN public.cruise_ship_pos tc ON tc.id = t.to_cspo_id
JOIN public.material_instances mi ON mi.id = t.material_instance_id
JOIN public.skus s ON s.id = mi.sku_id
LEFT JOIN public.profiles p1 ON p1.id = t.initiated_by
LEFT JOIN public.profiles p2 ON p2.id = t.acknowledged_by
ORDER BY t.initiated_at DESC;

GRANT SELECT ON public.cspo_closure_report, public.warehouse_load, public.transfer_audit
  TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Health check: expanded table list
CREATE OR REPLACE FUNCTION public.health_check()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'status', 'ok',
    'schema_version', '20260521000006',
    'tables_found', (
      SELECT count(*)::int
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY[
          'orgs', 'profiles', 'fleets', 'vessels', 'suppliers', 'locations', 'skus',
          'material_instances', 'inventory_movements', 'cruise_ship_pos', 'cspo_value_ledger',
          'proposals', 'proposal_line_items', 'material_lists', 'material_list_items',
          'packages', 'package_contents', 'commercial_invoices', 'pods',
          'onboard_receipts', 'usage_logs', 'transfer_events',
          'return_manifests', 'return_manifest_items',
          'procurement_requests', 'purchase_orders', 'sales_quotes', 'sales_orders',
          'audit_events'
        ])
    ),
    'tables_expected', 28
  );
$$;
