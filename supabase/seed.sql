-- ============================================================================
-- ShipSync — Seed Data
--
-- Idempotent (ON CONFLICT DO NOTHING). Safe to re-run.
-- Stable UUIDs let you reference these from the app during dev without
-- looking them up each time.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Default org: Full Sail Marine
-- ----------------------------------------------------------------------------
INSERT INTO public.orgs (id, name, slug) VALUES
  ('00000000-fffe-0000-0001-000000000001', 'Full Sail Marine', 'full-sail-marine')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Fleets (the major cruise lines)
-- ----------------------------------------------------------------------------
INSERT INTO public.fleets (id, org_id, name) VALUES
  ('00000000-fffe-0000-0002-000000000001', '00000000-fffe-0000-0001-000000000001', 'Carnival Cruise Line'),
  ('00000000-fffe-0000-0002-000000000002', '00000000-fffe-0000-0001-000000000001', 'Royal Caribbean International'),
  ('00000000-fffe-0000-0002-000000000003', '00000000-fffe-0000-0001-000000000001', 'Norwegian Cruise Line'),
  ('00000000-fffe-0000-0002-000000000004', '00000000-fffe-0000-0001-000000000001', 'Disney Cruise Line'),
  ('00000000-fffe-0000-0002-000000000005', '00000000-fffe-0000-0001-000000000001', 'MSC Cruises'),
  ('00000000-fffe-0000-0002-000000000006', '00000000-fffe-0000-0001-000000000001', 'Princess Cruises'),
  ('00000000-fffe-0000-0002-000000000007', '00000000-fffe-0000-0001-000000000001', 'Holland America Line'),
  ('00000000-fffe-0000-0002-000000000008', '00000000-fffe-0000-0001-000000000001', 'Celebrity Cruises')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Sample vessels (one or two per fleet, real names)
-- ----------------------------------------------------------------------------
INSERT INTO public.vessels (id, org_id, fleet_id, name, imo_number, vessel_type) VALUES
  ('00000000-fffe-0000-0003-000000000001', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000001', 'Carnival Mardi Gras',      '9837444', 'cruise'),
  ('00000000-fffe-0000-0003-000000000002', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000001', 'Carnival Celebration',     '9837456', 'cruise'),
  ('00000000-fffe-0000-0003-000000000003', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000002', 'Icon of the Seas',         '9869057', 'cruise'),
  ('00000000-fffe-0000-0003-000000000004', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000002', 'Wonder of the Seas',       '9838345', 'cruise'),
  ('00000000-fffe-0000-0003-000000000005', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000003', 'Norwegian Prima',          '9837377', 'cruise'),
  ('00000000-fffe-0000-0003-000000000006', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000004', 'Disney Wish',              '9837419', 'cruise'),
  ('00000000-fffe-0000-0003-000000000007', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000005', 'MSC World Europa',         '9826120', 'cruise'),
  ('00000000-fffe-0000-0003-000000000008', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0002-000000000006', 'Sun Princess',             '9802478', 'cruise')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Default warehouse + sample bays
-- ----------------------------------------------------------------------------
INSERT INTO public.locations (id, org_id, parent_id, name, type, code) VALUES
  ('00000000-fffe-0000-0004-000000000001', '00000000-fffe-0000-0001-000000000001', NULL,                                            'Main Warehouse', 'warehouse', 'WH-01'),
  ('00000000-fffe-0000-0004-000000000002', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0004-000000000001', 'Bay A',          'bay',       'A'),
  ('00000000-fffe-0000-0004-000000000003', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0004-000000000001', 'Bay B',          'bay',       'B'),
  ('00000000-fffe-0000-0004-000000000004', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0004-000000000001', 'Bay C',          'bay',       'C'),
  ('00000000-fffe-0000-0004-000000000005', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0004-000000000002', 'Shelf A-12',     'shelf',     'A-12'),
  ('00000000-fffe-0000-0004-000000000006', '00000000-fffe-0000-0001-000000000001', '00000000-fffe-0000-0004-000000000004', 'Shelf C-04',     'shelf',     'C-04'),
  ('00000000-fffe-0000-0004-000000000007', '00000000-fffe-0000-0001-000000000001', NULL,                                            'In Transit',     'transit',   'TRANSIT')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Sample SKUs
-- ----------------------------------------------------------------------------
INSERT INTO public.skus
  (id, org_id, sku_code, name, description, category, unit_of_measure,
   default_cost, default_sale_price, hts_code, reorder_threshold, serialized)
VALUES
  ('00000000-fffe-0000-0005-000000000001', '00000000-fffe-0000-0001-000000000001',
   'PETZL-ASAP-LOCK', 'Petzl ASAP Lock',
   'Fall arrester with locking function for vertical lifelines.',
   'fall protection', 'each', 285.00, 410.00, '8425.39.00', 6, true),
  ('00000000-fffe-0000-0005-000000000002', '00000000-fffe-0000-0001-000000000001',
   'AWLGRIP-2L', 'Awl Grip Topcoat 2L',
   'Two-component polyurethane topcoat, 2-liter tin.',
   'paint', 'tin', 168.00, 245.00, '3208.90.00', 12, false),
  ('00000000-fffe-0000-0005-000000000003', '00000000-fffe-0000-0001-000000000001',
   'GRIP-TAPE-3M', '3M Safety-Walk Grip Tape (60ft roll)',
   'Anti-slip tape, 2 in × 60 ft.',
   'safety', 'roll', 42.50, 78.00, '5906.99.00', 20, false),
  ('00000000-fffe-0000-0005-000000000004', '00000000-fffe-0000-0001-000000000001',
   'ROPE-50FT-DBL-BRAID', 'Double-braid Rope 50ft, 1/2 in',
   'Polyester double-braid rope, 50 ft × 1/2 in.',
   'rigging', 'each', 95.00, 145.00, '5607.49.00', 8, true),
  ('00000000-fffe-0000-0005-000000000005', '00000000-fffe-0000-0001-000000000001',
   'ALU-FRAME-CUSTOM', 'Custom Aluminum Frame',
   'Made-to-order aluminum mounting frame.',
   'fabrication', 'each', 620.00, 980.00, '7610.90.00', 0, true),
  ('00000000-fffe-0000-0005-000000000006', '00000000-fffe-0000-0001-000000000001',
   'COTTER-PIN-MIX', 'Cotter Pin Assortment',
   'Stainless steel cotter pin assortment, 200 pcs.',
   'fasteners', 'box', 18.00, 32.00, '7318.24.00', 30, false)
ON CONFLICT (id) DO NOTHING;
