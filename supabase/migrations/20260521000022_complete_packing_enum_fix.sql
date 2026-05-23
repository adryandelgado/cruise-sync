-- ============================================================================
-- ShipSync — Fix complete_packing: "planning" is not a valid cspo_status
-- Safe to re-run.
-- ============================================================================

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
    WHEN status IN ('draft', 'active', 'packing') THEN 'in_transit'::public.cspo_status
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

GRANT EXECUTE ON FUNCTION public.complete_packing(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
