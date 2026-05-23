-- ============================================================================
-- ShipSync — Warehouse pack session (single query)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pack_session(p_cspo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_list_id uuid;
  v_list_status text;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  SELECT ml.id, ml.status
  INTO v_list_id, v_list_status
  FROM public.material_lists ml
  WHERE ml.cspo_id = p_cspo_id AND ml.org_id = v_org_id;

  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'Material list not found for this CSPO';
  END IF;

  RETURN json_build_object(
    'cspo', (
      SELECT json_build_object(
        'id', c.id,
        'cspo_number', c.cspo_number,
        'status', c.status,
        'attendance_type', c.attendance_type,
        'vessel', json_build_object(
          'name', v.name,
          'fleet', CASE
            WHEN f.id IS NOT NULL THEN json_build_object('name', f.name)
            ELSE NULL
          END
        )
      )
      FROM public.cruise_ship_pos c
      JOIN public.vessels v ON v.id = c.vessel_id
      LEFT JOIN public.fleets f ON f.id = v.fleet_id
      WHERE c.id = p_cspo_id
    ),
    'list', json_build_object(
      'id', v_list_id,
      'status', v_list_status,
      'items', COALESCE((
        SELECT json_agg(row ORDER BY row->>'created_at')
        FROM (
          SELECT json_build_object(
            'id', mli.id,
            'sku_id', mli.sku_id,
            'custom_description', mli.custom_description,
            'requested_qty', mli.requested_qty,
            'packed_qty', mli.packed_qty,
            'status', mli.status,
            'procurement_request_id', mli.procurement_request_id,
            'created_at', mli.created_at,
            'procurement_request', CASE
              WHEN pr.id IS NOT NULL THEN json_build_object(
                'id', pr.id,
                'status', pr.status,
                'qty_needed', pr.qty_needed,
                'qty_received', pr.qty_received
              )
              ELSE NULL
            END,
            'sku', CASE
              WHEN s.id IS NOT NULL THEN json_build_object(
                'sku_code', s.sku_code,
                'name', s.name,
                'unit_of_measure', s.unit_of_measure
              )
              ELSE NULL
            END
          ) AS row
          FROM public.material_list_items mli
          LEFT JOIN public.procurement_requests pr ON pr.id = mli.procurement_request_id
          LEFT JOIN public.skus s ON s.id = mli.sku_id
          WHERE mli.list_id = v_list_id
          ORDER BY mli.created_at
        ) items_sub
      ), '[]'::json)
    ),
    'packages', COALESCE((
      SELECT json_agg(pkg_row ORDER BY (pkg_row->>'package_number')::int)
      FROM (
        SELECT json_build_object(
          'id', p.id,
          'package_type', p.package_type,
          'package_number', p.package_number,
          'status', p.status,
          'length', p.length,
          'width', p.width,
          'height', p.height,
          'weight', p.weight,
          'contents', COALESCE((
            SELECT json_agg(json_build_object('qty', pc.qty))
            FROM public.package_contents pc
            WHERE pc.package_id = p.id
          ), '[]'::json)
        ) AS pkg_row
        FROM public.packages p
        WHERE p.cspo_id = p_cspo_id AND p.org_id = v_org_id
        ORDER BY p.package_number
      ) pkg_sub
    ), '[]'::json),
    'stock_by_sku', COALESCE((
      SELECT json_object_agg(sub.sku_id::text, sub.on_hand)
      FROM (
        SELECT DISTINCT mli.sku_id, ss.on_hand
        FROM public.material_list_items mli
        JOIN public.sku_stock_summary ss ON ss.sku_id = mli.sku_id
        WHERE mli.list_id = v_list_id
          AND mli.sku_id IS NOT NULL
      ) sub
    ), '{}'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pack_session(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
