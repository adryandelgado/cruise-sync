-- ============================================================================
-- ShipSync — Packing & Shipping (Phase 3)
--
-- PREREQUISITE: run 20260521000001_proposals_and_material_lists.sql first.
-- That migration creates material_lists + material_list_items, which this
-- file references in package_contents and the pack RPCs.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'material_list_items'
  ) THEN
    RAISE EXCEPTION
      'Missing material_list_items — run 20260521000001_proposals_and_material_lists.sql first, then re-run this file.';
  END IF;
END $$;

CREATE TYPE public.package_type AS ENUM (
  'box',
  'toolbox',
  'pallet',
  'crate',
  'container',
  'platform'
);

CREATE TYPE public.package_status AS ENUM (
  'open',
  'sealed',
  'in_transit',
  'delivered',
  'returned'
);

CREATE TABLE public.packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id         uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  package_type    public.package_type NOT NULL DEFAULT 'pallet',
  package_number  int NOT NULL,
  length          numeric(8, 2),
  width           numeric(8, 2),
  height          numeric(8, 2),
  weight          numeric(10, 2),
  dim_unit        text NOT NULL DEFAULT 'in',
  weight_unit     text NOT NULL DEFAULT 'lb',
  status          public.package_status NOT NULL DEFAULT 'open',
  packed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  packed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cspo_id, package_number)
);

CREATE INDEX packages_org_id_idx  ON public.packages(org_id);
CREATE INDEX packages_cspo_idx    ON public.packages(cspo_id);
CREATE INDEX packages_status_idx  ON public.packages(status);

CREATE TRIGGER packages_set_updated_at
  BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.package_contents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  package_id            uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  material_instance_id  uuid REFERENCES public.material_instances(id) ON DELETE SET NULL,
  list_item_id          uuid REFERENCES public.material_list_items(id) ON DELETE SET NULL,
  qty                   numeric(10, 2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  description           text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX package_contents_package_idx ON public.package_contents(package_id);
CREATE INDEX package_contents_instance_idx ON public.package_contents(material_instance_id);

ALTER TABLE public.material_instances
  ADD CONSTRAINT material_instances_current_package_id_fkey
  FOREIGN KEY (current_package_id) REFERENCES public.packages(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements
  ADD COLUMN package_id uuid REFERENCES public.packages(id) ON DELETE SET NULL;

-- Extend sync trigger to carry package_id onto the instance cache.
CREATE OR REPLACE FUNCTION public.sync_material_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.material_instances
  SET status              = NEW.to_status,
      current_location_id = NEW.to_location_id,
      current_cspo_id     = COALESCE(NEW.cspo_id, current_cspo_id),
      current_package_id  = COALESCE(NEW.package_id, current_package_id)
  WHERE id = NEW.material_instance_id;
  RETURN NEW;
END;
$$;

CREATE TABLE public.commercial_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id         uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  invoice_number  text NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  total_value     numeric(14, 2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',
  pdf_url         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, invoice_number)
);

CREATE INDEX commercial_invoices_cspo_idx ON public.commercial_invoices(cspo_id);

CREATE TABLE public.pods (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id           uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  signed_at         timestamptz,
  freight_company   text,
  driver_name       text,
  signature_url     text,
  pdf_url           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pods_cspo_idx ON public.pods(cspo_id);

-- Pack one catalog unit into a package (atomic).
CREATE OR REPLACE FUNCTION public.pack_list_item_unit(
  p_list_item_id uuid,
  p_package_id   uuid,
  p_performed_by uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id       uuid;
  v_item         public.material_list_items%ROWTYPE;
  v_package      public.packages%ROWTYPE;
  v_instance_id  uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_item
  FROM public.material_list_items
  WHERE id = p_list_item_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'List item not found'; END IF;
  IF v_item.sku_id IS NULL THEN
    RAISE EXCEPTION 'Custom items must be packed manually';
  END IF;
  IF v_item.packed_qty >= v_item.requested_qty THEN
    RAISE EXCEPTION 'Item already fully packed';
  END IF;

  SELECT * INTO v_package
  FROM public.packages
  WHERE id = p_package_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found'; END IF;
  IF v_package.status <> 'open' THEN
    RAISE EXCEPTION 'Package is not open for packing';
  END IF;

  SELECT mi.id INTO v_instance_id
  FROM public.material_instances mi
  WHERE mi.org_id = v_org_id
    AND mi.sku_id = v_item.sku_id
    AND mi.status = 'in_stock'
  ORDER BY mi.acquired_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No in-stock instance available for this SKU';
  END IF;

  INSERT INTO public.inventory_movements (
    org_id, material_instance_id, to_status,
    cspo_id, package_id, performed_by, notes
  ) VALUES (
    v_org_id, v_instance_id, 'packed',
    v_package.cspo_id, p_package_id, p_performed_by,
    'Packed into package #' || v_package.package_number
  );

  INSERT INTO public.package_contents (
    org_id, package_id, material_instance_id, list_item_id, qty
  ) VALUES (
    v_org_id, p_package_id, v_instance_id, p_list_item_id, 1
  );

  UPDATE public.material_list_items
  SET packed_qty = packed_qty + 1,
      status = CASE
        WHEN packed_qty + 1 >= requested_qty THEN 'complete'::public.material_list_item_status
        ELSE 'pending'::public.material_list_item_status
      END
  WHERE id = p_list_item_id;

  UPDATE public.material_lists ml
  SET status = 'in_packing'::public.material_list_status
  FROM public.material_list_items mli
  WHERE mli.list_id = ml.id AND mli.id = p_list_item_id
    AND ml.status = 'submitted';

  RETURN v_instance_id;
END;
$$;

-- Pack a custom (non-SKU) line without touching inventory instances.
CREATE OR REPLACE FUNCTION public.pack_custom_list_item(
  p_list_item_id uuid,
  p_package_id   uuid,
  p_qty          numeric DEFAULT 1,
  p_performed_by uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_item     public.material_list_items%ROWTYPE;
  v_package  public.packages%ROWTYPE;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  SELECT * INTO v_item
  FROM public.material_list_items
  WHERE id = p_list_item_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'List item not found'; END IF;
  IF v_item.sku_id IS NOT NULL THEN
    RAISE EXCEPTION 'Use pack_list_item_unit for catalog SKUs';
  END IF;
  IF v_item.packed_qty + p_qty > v_item.requested_qty THEN
    RAISE EXCEPTION 'Would exceed requested quantity';
  END IF;

  SELECT * INTO v_package
  FROM public.packages
  WHERE id = p_package_id AND org_id = v_org_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found'; END IF;

  INSERT INTO public.package_contents (
    org_id, package_id, list_item_id, qty, description
  ) VALUES (
    v_org_id, p_package_id, p_list_item_id, p_qty, v_item.custom_description
  );

  UPDATE public.material_list_items
  SET packed_qty = packed_qty + p_qty,
      status = CASE
        WHEN packed_qty + p_qty >= requested_qty THEN 'complete'::public.material_list_item_status
        ELSE 'pending'::public.material_list_item_status
      END
  WHERE id = p_list_item_id;
END;
$$;

-- Seal packages, generate docs, advance CSPO to in_transit-ready state.
CREATE OR REPLACE FUNCTION public.complete_packing(
  p_cspo_id uuid,
  p_performed_by uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id       uuid;
  v_list         public.material_lists%ROWTYPE;
  v_cspo         public.cruise_ship_pos%ROWTYPE;
  v_invoice_id   uuid;
  v_invoice_no   text;
  v_total        numeric(14, 2);
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_cspo
  FROM public.cruise_ship_pos
  WHERE id = p_cspo_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'CSPO not found'; END IF;

  SELECT * INTO v_list
  FROM public.material_lists
  WHERE cspo_id = p_cspo_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Material list not found'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_list_items
    WHERE list_id = v_list.id AND packed_qty < requested_qty
  ) THEN
    RAISE EXCEPTION 'Not all items are fully packed';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.packages WHERE cspo_id = p_cspo_id) THEN
    RAISE EXCEPTION 'Create at least one package before completing';
  END IF;

  UPDATE public.packages
  SET status = 'sealed', packed_at = now(), packed_by = p_performed_by
  WHERE cspo_id = p_cspo_id AND status = 'open';

  UPDATE public.material_lists
  SET status = 'complete'
  WHERE id = v_list.id;

  UPDATE public.cruise_ship_pos
  SET status = 'in_transit'
  WHERE id = p_cspo_id;

  SELECT COALESCE(sum(s.default_cost), 0) INTO v_total
  FROM public.package_contents pc
  JOIN public.packages p ON p.id = pc.package_id
  LEFT JOIN public.material_instances mi ON mi.id = pc.material_instance_id
  LEFT JOIN public.skus s ON s.id = mi.sku_id
  WHERE p.cspo_id = p_cspo_id;

  v_invoice_no := 'COI-' || v_cspo.cspo_number;

  INSERT INTO public.commercial_invoices (
    org_id, cspo_id, invoice_number, total_value, currency
  ) VALUES (
    v_org_id, p_cspo_id, v_invoice_no, v_total, v_cspo.currency
  )
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.pods (org_id, cspo_id)
  VALUES (v_org_id, p_cspo_id);

  RETURN json_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_no,
    'total_value', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pack_list_item_unit(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pack_custom_list_item(uuid, uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_packing(uuid, uuid) TO authenticated;

-- RLS
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packages_select"
  ON public.packages FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "packages_write"
  ON public.packages FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'warehouse_supervisor', 'warehouse_operator')
  )
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "package_contents_select"
  ON public.package_contents FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "package_contents_write"
  ON public.package_contents FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'warehouse_supervisor', 'warehouse_operator')
  )
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "commercial_invoices_select"
  ON public.commercial_invoices FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "commercial_invoices_write"
  ON public.commercial_invoices FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'warehouse_supervisor'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "pods_select"
  ON public.pods FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "pods_write"
  ON public.pods FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'warehouse_supervisor', 'warehouse_operator')
  )
  WITH CHECK (org_id = public.current_org_id());
