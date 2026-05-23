-- ============================================================================
-- ShipSync — Initial Schema
--
-- The spine of the system:
--   * material_instances are physical objects tracked across custody states.
--   * inventory_movements is the append-only ledger of every state change.
--     The status column on material_instances is a denormalized cache,
--     kept in sync by trigger.
--   * cruise_ship_pos (CSPOs) are the financial containers that follow
--     materials through every state change.
--   * cspo_value_ledger is the append-only $$ ledger per CSPO. Sign
--     convention: positive amounts increase open balance (initial,
--     transferred_in), negative amounts decrease it (consumed, installed,
--     returned, transferred_out, written_off). `adjusted` can be either.
--
-- Multi-tenant ready: every business table carries org_id. RLS policies
-- (see next migration) scope reads to the caller's org.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext   WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
CREATE TYPE public.user_role AS ENUM (
  'admin',
  'sales',
  'pm',
  'warehouse_supervisor',
  'warehouse_operator',
  'purchase',
  'onboard_bookkeeper',
  'drydock_bookkeeper',
  'viewer'
);

CREATE TYPE public.material_status AS ENUM (
  'in_stock',
  'allocated',
  'packed',
  'in_transit',
  'on_vessel',
  'consumed',
  'installed',
  'returning',
  'inspecting',
  'damaged',
  'transferring',
  'written_off',
  'lost'
);

CREATE TYPE public.cspo_status AS ENUM (
  'draft',
  'active',
  'packing',
  'in_transit',
  'on_vessel',
  'in_progress',
  'closing',
  'closed',
  'cancelled'
);

CREATE TYPE public.cspo_attendance AS ENUM ('in_service', 'in_drydock');

CREATE TYPE public.location_type AS ENUM (
  'warehouse',
  'bay',
  'shelf',
  'drydock_zone',
  'vessel_zone',
  'transit',
  'supplier'
);

CREATE TYPE public.cspo_ledger_entry AS ENUM (
  'initial',
  'consumed',
  'installed',
  'returned',
  'transferred_out',
  'transferred_in',
  'written_off',
  'adjusted'
);

-- ----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- Auto-bump updated_at on row UPDATE.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Block UPDATE/DELETE on append-only ledger tables.
CREATE OR REPLACE FUNCTION public.block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    errcode = '42501',
    message = format(
      'Table %I is append-only; %s not allowed',
      TG_TABLE_NAME, TG_OP
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- ORGS
-- ----------------------------------------------------------------------------
CREATE TABLE public.orgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER orgs_set_updated_at
  BEFORE UPDATE ON public.orgs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- PROFILES (linked 1:1 with auth.users)
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE RESTRICT,
  email       citext NOT NULL,
  full_name   text,
  phone       text,
  role        public.user_role NOT NULL DEFAULT 'viewer',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_org_id_idx ON public.profiles(org_id);
CREATE INDEX profiles_role_idx   ON public.profiles(role);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Org/role helpers. SECURITY DEFINER so they bypass RLS on profiles when
-- called from inside policies (avoiding infinite recursion).
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(VARIADIC roles public.user_role[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND active
      AND role = ANY(roles)
  )
$$;

-- Auto-create a profile row when a new auth.users is inserted.
-- Picks the org from raw_app_meta_data->>'org_id' if set, else the sole org.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id      uuid;
  v_org_count   int;
BEGIN
  v_org_id := NULLIF(NEW.raw_app_meta_data ->> 'org_id', '')::uuid;

  IF v_org_id IS NULL THEN
    SELECT count(*) INTO v_org_count FROM public.orgs;
    IF v_org_count = 0 THEN
      RAISE EXCEPTION 'No orgs exist; seed an org before allowing signups.';
    ELSIF v_org_count = 1 THEN
      SELECT id INTO v_org_id FROM public.orgs;
    ELSE
      RAISE EXCEPTION
        'Multiple orgs exist; specify org_id in raw_app_meta_data on signup.';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, org_id, email, full_name, role)
  VALUES (
    NEW.id,
    v_org_id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    COALESCE(
      NULLIF(NEW.raw_app_meta_data ->> 'role', '')::public.user_role,
      'pm'
    )
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- CATALOG: fleets, vessels, suppliers, locations, skus
-- ----------------------------------------------------------------------------
CREATE TABLE public.fleets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX fleets_org_id_idx ON public.fleets(org_id);

CREATE TRIGGER fleets_set_updated_at
  BEFORE UPDATE ON public.fleets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.vessels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  fleet_id     uuid NOT NULL REFERENCES public.fleets(id) ON DELETE RESTRICT,
  name         text NOT NULL,
  imo_number   text,
  vessel_type  text,
  notes        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name),
  UNIQUE (org_id, imo_number)
);

CREATE INDEX vessels_org_id_idx   ON public.vessels(org_id);
CREATE INDEX vessels_fleet_id_idx ON public.vessels(fleet_id);

CREATE TRIGGER vessels_set_updated_at
  BEFORE UPDATE ON public.vessels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  name            text NOT NULL,
  contact_email   citext,
  contact_phone   text,
  payment_terms   text,
  default_currency text NOT NULL DEFAULT 'USD',
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX suppliers_org_id_idx ON public.suppliers(org_id);

CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  name        text NOT NULL,
  type        public.location_type NOT NULL,
  code        text,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX locations_org_id_idx    ON public.locations(org_id);
CREATE INDEX locations_parent_id_idx ON public.locations(parent_id);
CREATE INDEX locations_type_idx      ON public.locations(type);

CREATE TRIGGER locations_set_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.skus (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  sku_code            citext NOT NULL,
  name                text NOT NULL,
  description         text,
  category            text,
  unit_of_measure     text NOT NULL DEFAULT 'each',
  default_cost        numeric(12, 2),
  default_sale_price  numeric(12, 2),
  currency            text NOT NULL DEFAULT 'USD',
  hts_code            text,
  supplier_id         uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  reorder_threshold   int,
  serialized          boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sku_code)
);

CREATE INDEX skus_org_id_idx      ON public.skus(org_id);
CREATE INDEX skus_supplier_id_idx ON public.skus(supplier_id);
CREATE INDEX skus_category_idx    ON public.skus(category);

CREATE TRIGGER skus_set_updated_at
  BEFORE UPDATE ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- CSPO (Cruise Ship PO) — the financial spine
-- ----------------------------------------------------------------------------
CREATE TABLE public.cruise_ship_pos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_number           text NOT NULL,
  vessel_id             uuid NOT NULL REFERENCES public.vessels(id) ON DELETE RESTRICT,
  proposal_id           uuid,  -- FK added when proposals table lands
  attendance_type       public.cspo_attendance NOT NULL,
  port_of_service       text,
  planned_start         date,
  planned_end           date,
  actual_start          date,
  actual_end            date,
  assigned_pm           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_bookkeeper   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_supervisor   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  original_value        numeric(14, 2) NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'USD',
  status                public.cspo_status NOT NULL DEFAULT 'draft',
  closure_notes         text,
  created_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, cspo_number)
);

CREATE INDEX cspos_org_id_idx    ON public.cruise_ship_pos(org_id);
CREATE INDEX cspos_vessel_id_idx ON public.cruise_ship_pos(vessel_id);
CREATE INDEX cspos_status_idx    ON public.cruise_ship_pos(status);
CREATE INDEX cspos_assigned_pm_idx ON public.cruise_ship_pos(assigned_pm);

CREATE TRIGGER cspos_set_updated_at
  BEFORE UPDATE ON public.cruise_ship_pos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- MATERIAL INSTANCES — the physical objects
-- ----------------------------------------------------------------------------
CREATE TABLE public.material_instances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  sku_id                uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  serial_number         text,
  lot_number            text,
  status                public.material_status NOT NULL DEFAULT 'in_stock',
  current_location_id   uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  current_cspo_id       uuid REFERENCES public.cruise_ship_pos(id) ON DELETE SET NULL,
  current_package_id    uuid,  -- FK added when packages table lands
  acquired_at           timestamptz NOT NULL DEFAULT now(),
  acquired_cost         numeric(12, 2),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- A serial_number, when set, is unique per org/SKU.
  UNIQUE (org_id, sku_id, serial_number)
);

CREATE INDEX material_instances_org_id_idx      ON public.material_instances(org_id);
CREATE INDEX material_instances_sku_id_idx      ON public.material_instances(sku_id);
CREATE INDEX material_instances_status_idx      ON public.material_instances(status);
CREATE INDEX material_instances_location_idx    ON public.material_instances(current_location_id);
CREATE INDEX material_instances_cspo_idx        ON public.material_instances(current_cspo_id);
CREATE INDEX material_instances_serial_idx
  ON public.material_instances(serial_number)
  WHERE serial_number IS NOT NULL;

CREATE TRIGGER material_instances_set_updated_at
  BEFORE UPDATE ON public.material_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- INVENTORY MOVEMENTS — the append-only physical ledger
-- ----------------------------------------------------------------------------
CREATE TABLE public.inventory_movements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  material_instance_id  uuid NOT NULL REFERENCES public.material_instances(id) ON DELETE RESTRICT,
  from_status           public.material_status,
  to_status             public.material_status NOT NULL,
  from_location_id      uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id        uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  cspo_id               uuid REFERENCES public.cruise_ship_pos(id) ON DELETE SET NULL,
  reason_code           text,
  notes                 text,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  performed_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inv_movements_org_id_idx ON public.inventory_movements(org_id);
CREATE INDEX inv_movements_instance_idx
  ON public.inventory_movements(material_instance_id, occurred_at DESC);
CREATE INDEX inv_movements_cspo_idx
  ON public.inventory_movements(cspo_id)
  WHERE cspo_id IS NOT NULL;
CREATE INDEX inv_movements_occurred_at_idx ON public.inventory_movements(occurred_at DESC);

-- Append-only guard.
CREATE TRIGGER inv_movements_no_update
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.block_mutation();

-- Before insert: lock the material instance row, auto-fill from_status,
-- and reject stale-state transitions.
CREATE OR REPLACE FUNCTION public.validate_inventory_movement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_current_status public.material_status;
  v_org_id         uuid;
BEGIN
  SELECT status, org_id INTO v_current_status, v_org_id
  FROM public.material_instances
  WHERE id = NEW.material_instance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_instance % does not exist',
      NEW.material_instance_id;
  END IF;

  IF NEW.org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION
      'inventory_movement org_id (%) does not match material_instance org_id (%)',
      NEW.org_id, v_org_id;
  END IF;

  IF NEW.from_status IS NULL THEN
    NEW.from_status := v_current_status;
  ELSIF NEW.from_status <> v_current_status THEN
    RAISE EXCEPTION
      'Stale state for material_instance %: current is %, movement claims from %',
      NEW.material_instance_id, v_current_status, NEW.from_status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER inv_movements_validate
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_movement();

-- After insert: sync the denormalized cache on material_instances.
CREATE OR REPLACE FUNCTION public.sync_material_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.material_instances
  SET status              = NEW.to_status,
      current_location_id = NEW.to_location_id,
      current_cspo_id     = NEW.cspo_id
  WHERE id = NEW.material_instance_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inv_movements_sync
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.sync_material_status();

-- ----------------------------------------------------------------------------
-- CSPO VALUE LEDGER — the append-only financial ledger
-- ----------------------------------------------------------------------------
-- Sign convention:
--   positive amount  → value enters CSPO open balance
--                       (initial, transferred_in)
--   negative amount  → value leaves open balance
--                       (consumed, installed, returned, transferred_out,
--                        written_off)
--   adjusted may carry either sign.
-- The application is responsible for inserting amounts with the right sign;
-- a check constraint enforces the convention per entry_type.
CREATE TABLE public.cspo_value_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  cspo_id               uuid NOT NULL REFERENCES public.cruise_ship_pos(id) ON DELETE CASCADE,
  entry_type            public.cspo_ledger_entry NOT NULL,
  amount                numeric(14, 2) NOT NULL,
  currency              text NOT NULL DEFAULT 'USD',
  material_instance_id  uuid REFERENCES public.material_instances(id) ON DELETE SET NULL,
  related_event_id      uuid,  -- generic pointer (e.g. transfer_events.id)
  notes                 text,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  performed_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cspo_ledger_sign_check CHECK (
    (entry_type IN ('initial', 'transferred_in')         AND amount >= 0) OR
    (entry_type IN ('consumed', 'installed', 'returned',
                    'transferred_out', 'written_off')    AND amount <= 0) OR
    (entry_type = 'adjusted')
  )
);

CREATE INDEX cspo_ledger_org_id_idx ON public.cspo_value_ledger(org_id);
CREATE INDEX cspo_ledger_cspo_idx
  ON public.cspo_value_ledger(cspo_id, occurred_at DESC);
CREATE INDEX cspo_ledger_entry_type_idx ON public.cspo_value_ledger(entry_type);
CREATE INDEX cspo_ledger_instance_idx
  ON public.cspo_value_ledger(material_instance_id)
  WHERE material_instance_id IS NOT NULL;

-- Append-only guard.
CREATE TRIGGER cspo_ledger_no_update
  BEFORE UPDATE OR DELETE ON public.cspo_value_ledger
  FOR EACH ROW EXECUTE FUNCTION public.block_mutation();

-- ----------------------------------------------------------------------------
-- VIEWS — live summaries
-- ----------------------------------------------------------------------------

-- Per-CSPO live financial summary. Computes value buckets from the ledger
-- (source of truth). open_balance = SUM of all signed amounts.
CREATE OR REPLACE VIEW public.cspo_live_summary AS
SELECT
  c.id                                                                   AS cspo_id,
  c.org_id,
  c.cspo_number,
  c.vessel_id,
  c.attendance_type,
  c.status,
  c.original_value,
  c.currency,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'consumed'), 0)        AS consumed_value,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'installed'), 0)       AS installed_value,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'returned'), 0)        AS returned_value,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'transferred_out'), 0) AS transferred_out_value,
  COALESCE( SUM(l.amount) FILTER (WHERE l.entry_type = 'transferred_in'), 0)  AS transferred_in_value,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'written_off'), 0)     AS written_off_value,
  COALESCE( SUM(l.amount) FILTER (WHERE l.entry_type = 'adjusted'), 0)        AS adjusted_value,
  COALESCE( SUM(l.amount), 0)                                                  AS open_balance,
  (
    SELECT count(*) FROM public.material_instances mi
    WHERE mi.current_cspo_id = c.id
      AND mi.status = 'on_vessel'
  )                                                                            AS items_on_vessel
FROM public.cruise_ship_pos c
LEFT JOIN public.cspo_value_ledger l ON l.cspo_id = c.id
GROUP BY c.id;

-- Lifetime trace of a material instance across CSPOs.
CREATE OR REPLACE VIEW public.material_lifetime_log AS
SELECT
  m.id AS movement_id,
  m.org_id,
  m.material_instance_id,
  s.sku_code,
  s.name AS sku_name,
  m.from_status,
  m.to_status,
  m.cspo_id,
  c.cspo_number,
  m.from_location_id,
  m.to_location_id,
  m.reason_code,
  m.notes,
  m.occurred_at,
  m.performed_by
FROM public.inventory_movements m
JOIN public.material_instances mi ON mi.id = m.material_instance_id
JOIN public.skus s ON s.id = mi.sku_id
LEFT JOIN public.cruise_ship_pos c ON c.id = m.cspo_id
ORDER BY m.material_instance_id, m.occurred_at;
