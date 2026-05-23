-- ============================================================================
-- ShipSync — Proposals & Material Lists (Phase 2)
-- ============================================================================

CREATE TYPE public.proposal_status AS ENUM (
  'draft',
  'sent',
  'approved',
  'rejected',
  'converted'
);

CREATE TYPE public.material_list_status AS ENUM (
  'draft',
  'submitted',
  'in_packing',
  'partially_packed',
  'awaiting_procurement',
  'complete'
);

CREATE TYPE public.material_list_item_status AS ENUM (
  'pending',
  'packed',
  'procuring',
  'complete'
);

-- ----------------------------------------------------------------------------
-- PROPOSALS
-- ----------------------------------------------------------------------------
CREATE TABLE public.proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  proposal_number   text NOT NULL,
  vessel_id         uuid NOT NULL REFERENCES public.vessels(id) ON DELETE RESTRICT,
  scope_summary     text,
  total_value       numeric(14, 2) NOT NULL DEFAULT 0,
  currency          text NOT NULL DEFAULT 'USD',
  status            public.proposal_status NOT NULL DEFAULT 'draft',
  sent_at           timestamptz,
  approved_at       timestamptz,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proposal_number)
);

CREATE INDEX proposals_org_id_idx   ON public.proposals(org_id);
CREATE INDEX proposals_vessel_idx   ON public.proposals(vessel_id);
CREATE INDEX proposals_status_idx   ON public.proposals(status);

CREATE TRIGGER proposals_set_updated_at
  BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.proposal_line_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  proposal_id         uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  sku_id              uuid REFERENCES public.skus(id) ON DELETE SET NULL,
  custom_description  text,
  qty                 numeric(10, 2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price          numeric(12, 2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proposal_line_has_item CHECK (
    sku_id IS NOT NULL OR custom_description IS NOT NULL
  )
);

CREATE INDEX proposal_lines_proposal_idx ON public.proposal_line_items(proposal_id);

-- Link CSPOs back to the proposal they were activated from.
ALTER TABLE public.cruise_ship_pos
  ADD CONSTRAINT cruise_ship_pos_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- MATERIAL LISTS
-- ----------------------------------------------------------------------------
CREATE TABLE public.material_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id       uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  status        public.material_list_status NOT NULL DEFAULT 'draft',
  submitted_at  timestamptz,
  submitted_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cspo_id)
);

CREATE INDEX material_lists_org_id_idx ON public.material_lists(org_id);
CREATE INDEX material_lists_status_idx ON public.material_lists(status);

CREATE TRIGGER material_lists_set_updated_at
  BEFORE UPDATE ON public.material_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.material_list_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  list_id                 uuid NOT NULL REFERENCES public.material_lists(id) ON DELETE CASCADE,
  sku_id                  uuid REFERENCES public.skus(id) ON DELETE SET NULL,
  custom_description      text,
  requested_qty           numeric(10, 2) NOT NULL DEFAULT 1 CHECK (requested_qty > 0),
  packed_qty              numeric(10, 2) NOT NULL DEFAULT 0 CHECK (packed_qty >= 0),
  status                  public.material_list_item_status NOT NULL DEFAULT 'pending',
  procurement_request_id  uuid,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT material_list_item_has_item CHECK (
    sku_id IS NOT NULL OR custom_description IS NOT NULL
  )
);

CREATE INDEX material_list_items_list_idx ON public.material_list_items(list_id);
CREATE INDEX material_list_items_sku_idx  ON public.material_list_items(sku_id);

CREATE TRIGGER material_list_items_set_updated_at
  BEFORE UPDATE ON public.material_list_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- VIEWS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.sku_stock_summary AS
SELECT
  s.id          AS sku_id,
  s.org_id,
  s.sku_code,
  s.name,
  s.category,
  s.unit_of_measure,
  s.default_cost,
  s.reorder_threshold,
  COALESCE(
    count(mi.id) FILTER (WHERE mi.status = 'in_stock'),
    0
  )::int AS on_hand,
  COALESCE(
    count(mi.id) FILTER (WHERE mi.status IN ('allocated', 'packed')),
    0
  )::int AS allocated,
  COALESCE(
    count(mi.id) FILTER (WHERE mi.status IN (
      'in_transit', 'on_vessel', 'returning', 'transferring'
    )),
    0
  )::int AS in_field
FROM public.skus s
LEFT JOIN public.material_instances mi ON mi.sku_id = s.id
WHERE s.active = true
GROUP BY s.id;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proposals_select"
  ON public.proposals FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "proposals_write"
  ON public.proposals FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'sales'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "proposal_lines_select"
  ON public.proposal_line_items FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "proposal_lines_write"
  ON public.proposal_line_items FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm', 'sales'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "material_lists_select"
  ON public.material_lists FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "material_lists_write"
  ON public.material_lists FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role('admin', 'pm'))
  WITH CHECK (org_id = public.current_org_id());

CREATE POLICY "material_list_items_select"
  ON public.material_list_items FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY "material_list_items_write"
  ON public.material_list_items FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.has_role('admin', 'pm', 'warehouse_supervisor', 'warehouse_operator')
  )
  WITH CHECK (org_id = public.current_org_id());

GRANT SELECT ON public.sku_stock_summary TO authenticated;
