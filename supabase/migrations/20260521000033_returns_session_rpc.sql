-- ============================================================================
-- ShipSync — Returns & transfers session (single query)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_returns_session(p_cspo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  RETURN json_build_object(
    'inventory', public.onboard_sku_inventory(p_cspo_id),
    'manifest', (
      SELECT json_build_object(
        'id', rm.id,
        'status', rm.status,
        'freight_company', rm.freight_company,
        'created_at', rm.created_at,
        'items', COALESCE((
          SELECT json_agg(item_row ORDER BY item_row->>'id')
          FROM (
            SELECT json_build_object(
              'id', rmi.id,
              'condition', rmi.condition,
              'material_instance', json_build_object(
                'id', mi.id,
                'sku', CASE
                  WHEN s.id IS NOT NULL THEN json_build_object(
                    'sku_code', s.sku_code,
                    'name', s.name
                  )
                  ELSE NULL
                END
              )
            ) AS item_row
            FROM public.return_manifest_items rmi
            JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
            LEFT JOIN public.skus s ON s.id = mi.sku_id
            WHERE rmi.manifest_id = rm.id
          ) items_sub
        ), '[]'::json)
      )
      FROM public.return_manifests rm
      WHERE rm.cspo_id = p_cspo_id
        AND rm.org_id = v_org_id
        AND rm.status = 'draft'
      LIMIT 1
    ),
    'pending_transfers', COALESCE((
      SELECT json_agg(row ORDER BY row->>'initiated_at' DESC)
      FROM (
        SELECT json_build_object(
          'id', te.id,
          'transferred_value', te.transferred_value,
          'currency', te.currency,
          'initiated_at', te.initiated_at,
          'notes', te.notes,
          'to_cspo_id', te.to_cspo_id,
          'from_cspo', json_build_object(
            'cspo_number', fc.cspo_number
          ),
          'to_cspo', json_build_object(
            'cspo_number', tc.cspo_number
          ),
          'material_instance', json_build_object(
            'sku', CASE
              WHEN s.id IS NOT NULL THEN json_build_object(
                'sku_code', s.sku_code,
                'name', s.name
              )
              ELSE NULL
            END
          )
        ) AS row
        FROM public.transfer_events te
        JOIN public.cruise_ship_pos fc ON fc.id = te.from_cspo_id
        JOIN public.cruise_ship_pos tc ON tc.id = te.to_cspo_id
        JOIN public.material_instances mi ON mi.id = te.material_instance_id
        LEFT JOIN public.skus s ON s.id = mi.sku_id
        WHERE te.to_cspo_id = p_cspo_id
          AND te.org_id = v_org_id
          AND te.acknowledged_at IS NULL
        ORDER BY te.initiated_at DESC
      ) xfer_sub
    ), '[]'::json),
    'open_cspos', COALESCE((
      SELECT json_agg(row ORDER BY row->>'cspo_number')
      FROM (
        SELECT json_build_object(
          'id', c.id,
          'cspo_number', c.cspo_number,
          'vessel', json_build_object('name', v.name)
        ) AS row
        FROM public.cruise_ship_pos c
        JOIN public.vessels v ON v.id = c.vessel_id
        WHERE c.org_id = v_org_id
          AND c.status NOT IN ('closed', 'cancelled', 'draft')
        ORDER BY c.cspo_number
      ) cspo_sub
    ), '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_returns_session(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
