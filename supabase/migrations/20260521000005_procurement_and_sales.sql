-- ============================================================================
-- ShipSync — Procurement & Sales (blueprint §6.3, §6.5)
-- ============================================================================

CREATE TYPE public.procurement_status AS ENUM (
  'open',
  'ordered',
  'partial',
  'received',
  'cancelled'
);

CREATE TYPE public.purchase_order_status AS ENUM (
  'draft',
  'ordered',
  'partial',
  'received',
  'cancelled'
);

CREATE TYPE public.sales_quote_status AS ENUM (
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired'
);

CREATE TYPE public.sales_order_status AS ENUM (
  'draft',
  'confirmed',
  'shipped',
  'invoiced',
  'cancelled'
);

CREATE TABLE public.procurement_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id         uuid REFERENCES public.cruise_ship_pos(id) ON DELETE SET NULL,
  sku_id          uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty_needed      numeric(10, 2) NOT NULL CHECK (qty_needed > 0),
  qty_received    numeric(10, 2) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  supplier_id     uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status          public.procurement_status NOT NULL DEFAULT 'open',
  needed_by       date,
  requested_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX procurement_requests_org_idx    ON public.procurement_requests(org_id);
CREATE INDEX procurement_requests_status_idx ON public.procurement_requests(status);
CREATE INDEX procurement_requests_cspo_idx   ON public.procurement_requests(cspo_id);

CREATE TRIGGER procurement_requests_set_updated_at
  BEFORE UPDATE ON public.procurement_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.material_list_items
  ADD CONSTRAINT material_list_items_procurement_request_id_fkey
  FOREIGN KEY (procurement_request_id) REFERENCES public.procurement_requests(id)
  ON DELETE SET NULL;

CREATE TABLE public.purchase_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  po_number     text NOT NULL,
  supplier_id   uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  total         numeric(14, 2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'USD',
  status        public.purchase_order_status NOT NULL DEFAULT 'draft',
  ordered_at    timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, po_number)
);

CREATE INDEX purchase_orders_org_idx ON public.purchase_orders(org_id);

CREATE TRIGGER purchase_orders_set_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.purchase_order_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  po_id                   uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sku_id                  uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty                     numeric(10, 2) NOT NULL CHECK (qty > 0),
  unit_cost               numeric(12, 2) NOT NULL DEFAULT 0,
  qty_received            numeric(10, 2) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  procurement_request_id  uuid REFERENCES public.procurement_requests(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX purchase_order_lines_po_idx ON public.purchase_order_lines(po_id);

CREATE TABLE public.sales_quotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  quote_number  text NOT NULL,
  vessel_id     uuid REFERENCES public.vessels(id) ON DELETE SET NULL,
  total         numeric(14, 2) NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'USD',
  status        public.sales_quote_status NOT NULL DEFAULT 'draft',
  valid_until   date,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, quote_number)
);

CREATE INDEX sales_quotes_org_idx ON public.sales_quotes(org_id);

CREATE TRIGGER sales_quotes_set_updated_at
  BEFORE UPDATE ON public.sales_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sales_quote_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  quote_id    uuid NOT NULL REFERENCES public.sales_quotes(id) ON DELETE CASCADE,
  sku_id      uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty         numeric(10, 2) NOT NULL CHECK (qty > 0),
  unit_price  numeric(12, 2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sales_quote_lines_quote_idx ON public.sales_quote_lines(quote_id);

CREATE TABLE public.sales_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  so_number   text NOT NULL,
  quote_id    uuid REFERENCES public.sales_quotes(id) ON DELETE SET NULL,
  cspo_id     uuid REFERENCES public.cruise_ship_pos(id) ON DELETE SET NULL,
  total       numeric(14, 2) NOT NULL DEFAULT 0,
  currency    text NOT NULL DEFAULT 'USD',
  status      public.sales_order_status NOT NULL DEFAULT 'draft',
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, so_number)
);

CREATE INDEX sales_orders_org_idx ON public.sales_orders(org_id);

CREATE TRIGGER sales_orders_set_updated_at
  BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sales_order_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  so_id       uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  sku_id      uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty         numeric(10, 2) NOT NULL CHECK (qty > 0),
  unit_price  numeric(12, 2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sales_order_lines_so_idx ON public.sales_order_lines(so_id);

-- Flag a stock-out from warehouse or material list.
CREATE OR REPLACE FUNCTION public.create_procurement_request(
  p_sku_id        uuid,
  p_qty_needed    numeric,
  p_cspo_id       uuid DEFAULT NULL,
  p_list_item_id  uuid DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_requested_by  uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_req_id uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_qty_needed <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  INSERT INTO public.procurement_requests (
    org_id, cspo_id, sku_id, qty_needed, requested_by, notes
  ) VALUES (
    v_org_id, p_cspo_id, p_sku_id, p_qty_needed, p_requested_by, p_notes
  )
  RETURNING id INTO v_req_id;

  IF p_list_item_id IS NOT NULL THEN
    UPDATE public.material_list_items
    SET procurement_request_id = v_req_id,
        status = 'procuring'::public.material_list_item_status
    WHERE id = p_list_item_id AND org_id = v_org_id;

    UPDATE public.material_lists ml
    SET status = 'awaiting_procurement'::public.material_list_status
    FROM public.material_list_items mli
    WHERE mli.list_id = ml.id AND mli.id = p_list_item_id;
  END IF;

  RETURN v_req_id;
END;
$$;

-- Receive supplier stock: create material instances + close procurement.
CREATE OR REPLACE FUNCTION public.receive_procurement(
  p_request_id    uuid,
  p_qty_received  numeric,
  p_location_id   uuid DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id   uuid;
  v_req      public.procurement_requests%ROWTYPE;
  v_loc_id   uuid;
  v_cost     numeric(12, 2);
  i          int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_qty_received <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  SELECT * INTO v_req
  FROM public.procurement_requests
  WHERE id = p_request_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Procurement request not found'; END IF;

  SELECT default_cost INTO v_cost FROM public.skus WHERE id = v_req.sku_id;

  v_loc_id := p_location_id;
  IF v_loc_id IS NULL THEN
    SELECT id INTO v_loc_id FROM public.locations
    WHERE org_id = v_org_id AND type = 'warehouse'
    LIMIT 1;
  END IF;

  FOR i IN 1 .. p_qty_received::int LOOP
    INSERT INTO public.material_instances (
      org_id, sku_id, status, current_location_id, acquired_cost
    ) VALUES (
      v_org_id, v_req.sku_id, 'in_stock', v_loc_id, v_cost
    );
  END LOOP;

  UPDATE public.procurement_requests
  SET qty_received = qty_received + p_qty_received,
      status = CASE
        WHEN qty_received + p_qty_received >= qty_needed THEN 'received'::public.procurement_status
        ELSE 'partial'::public.procurement_status
      END
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_procurement_request(uuid, numeric, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_procurement(uuid, numeric, uuid, uuid) TO authenticated;

-- RLS
ALTER TABLE public.procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "procurement_requests_select"
  ON public.procurement_requests FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "procurement_requests_write"
  ON public.procurement_requests FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'purchase', 'warehouse_supervisor'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "purchase_orders_select"
  ON public.purchase_orders FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "purchase_orders_write"
  ON public.purchase_orders FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'purchase'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "purchase_order_lines_select"
  ON public.purchase_order_lines FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "purchase_order_lines_write"
  ON public.purchase_order_lines FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'purchase'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "sales_quotes_select"
  ON public.sales_quotes FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "sales_quotes_write"
  ON public.sales_quotes FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'sales'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "sales_quote_lines_select"
  ON public.sales_quote_lines FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "sales_quote_lines_write"
  ON public.sales_quote_lines FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'sales'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "sales_orders_select"
  ON public.sales_orders FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "sales_orders_write"
  ON public.sales_orders FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'sales'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "sales_order_lines_select"
  ON public.sales_order_lines FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "sales_order_lines_write"
  ON public.sales_order_lines FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'sales'))
  WITH CHECK (org_id = public.current_org_id());

NOTIFY pgrst, 'reload schema';
