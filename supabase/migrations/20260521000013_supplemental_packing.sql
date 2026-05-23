-- ============================================================================
-- ShipSync — Supplemental packing after empty/custom-only receive
-- Allows adding SKU line items and shipping another package when a CSPO
-- was received aboard with 0 trackable instances.
-- Safe to re-run.
-- ============================================================================

-- Reopen a completed list so warehouse can pack new SKU line items.
CREATE OR REPLACE FUNCTION public.reopen_material_list_for_packing(
  p_cspo_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id  uuid;
  v_list_id uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_list_id
  FROM public.material_lists
  WHERE cspo_id = p_cspo_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Material list not found'; END IF;

  UPDATE public.material_lists
  SET status = 'in_packing'::public.material_list_status
  WHERE id = v_list_id
    AND status IN (
      'complete'::public.material_list_status,
      'submitted'::public.material_list_status,
      'partially_packed'::public.material_list_status
    );

  RETURN v_list_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_material_list_for_packing(uuid) TO authenticated;

-- Allow packing into a completed list when new line items were added.
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
    AND ml.status IN (
      'submitted'::public.material_list_status,
      'complete'::public.material_list_status,
      'partially_packed'::public.material_list_status
    );

  RETURN v_instance_id;
END;
$$;

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

  UPDATE public.material_lists ml
  SET status = 'in_packing'::public.material_list_status
  FROM public.material_list_items mli
  WHERE mli.list_id = ml.id AND mli.id = p_list_item_id
    AND ml.status IN (
      'submitted'::public.material_list_status,
      'complete'::public.material_list_status,
      'partially_packed'::public.material_list_status
    );
END;
$$;

-- Supplemental shipment: seal only open packages; do not regress CSPO status.
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
  v_open_count   int;
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

  SELECT count(*) INTO v_open_count
  FROM public.packages
  WHERE cspo_id = p_cspo_id AND status = 'open';

  IF v_open_count = 0 THEN
    RAISE EXCEPTION 'Create at least one open package with items before completing';
  END IF;

  UPDATE public.packages
  SET status = 'sealed', packed_at = now(), packed_by = p_performed_by
  WHERE cspo_id = p_cspo_id AND status = 'open';

  UPDATE public.material_lists
  SET status = 'complete'
  WHERE id = v_list.id;

  UPDATE public.cruise_ship_pos
  SET status = CASE
    WHEN status IN ('draft', 'planning', 'packing') THEN 'in_transit'::public.cspo_status
    ELSE status
  END,
  actual_start = COALESCE(actual_start, CURRENT_DATE)
  WHERE id = p_cspo_id;

  SELECT COALESCE(sum(s.default_cost), 0) INTO v_total
  FROM public.package_contents pc
  JOIN public.packages p ON p.id = pc.package_id
  LEFT JOIN public.material_instances mi ON mi.id = pc.material_instance_id
  LEFT JOIN public.skus s ON s.id = mi.sku_id
  WHERE p.cspo_id = p_cspo_id
    AND p.status IN ('sealed', 'in_transit', 'delivered');

  v_invoice_no := 'COI-' || v_cspo.cspo_number;

  INSERT INTO public.commercial_invoices (
    org_id, cspo_id, invoice_number, total_value, currency
  ) VALUES (
    v_org_id, p_cspo_id, v_invoice_no, v_total, v_cspo.currency
  )
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.pods (org_id, cspo_id)
  SELECT v_org_id, p_cspo_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pods WHERE cspo_id = p_cspo_id AND org_id = v_org_id
  );

  RETURN json_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_no,
    'total_value', v_total
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
