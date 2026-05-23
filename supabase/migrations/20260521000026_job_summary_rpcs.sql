-- ============================================================================
-- ShipSync — Onboard job list + return restock summary (single-query RPCs)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_onboard_jobs()
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

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'updated_at' DESC)
    FROM (
      SELECT json_build_object(
        'cspo_id', c.id,
        'cspo_number', c.cspo_number,
        'status', c.status,
        'attendance_type', c.attendance_type,
        'updated_at', c.updated_at,
        'vessel', json_build_object(
          'name', v.name,
          'fleet', CASE
            WHEN f.id IS NOT NULL THEN json_build_object('name', f.name)
            ELSE NULL
          END
        ),
        'total_packages', (
          SELECT count(*)::int FROM public.packages p WHERE p.cspo_id = c.id
        ),
        'received_packages', (
          SELECT count(*)::int FROM public.onboard_receipts r WHERE r.cspo_id = c.id
        ),
        'items_on_vessel', (
          SELECT count(*)::int
          FROM public.material_instances mi
          WHERE mi.current_cspo_id = c.id AND mi.status = 'on_vessel'
        ),
        'pending_transfers', (
          SELECT count(*)::int
          FROM public.transfer_events te
          WHERE te.to_cspo_id = c.id AND te.acknowledged_at IS NULL
        )
      ) AS row
      FROM public.cruise_ship_pos c
      JOIN public.vessels v ON v.id = c.vessel_id
      LEFT JOIN public.fleets f ON f.id = v.fleet_id
      WHERE c.org_id = v_org_id
        AND c.status IN ('in_transit', 'on_vessel', 'in_progress')
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_return_restock_jobs()
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

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'created_at')
    FROM (
      SELECT json_build_object(
        'manifest_id', rm.id,
        'status', rm.status,
        'freight_company', rm.freight_company,
        'created_at', rm.created_at,
        'cspo_id', c.id,
        'cspo_number', c.cspo_number,
        'vessel_name', v.name,
        'total_units', count(rmi.id)::int,
        'pending_units', count(rmi.id) FILTER (WHERE rmi.received_back_at IS NULL)::int,
        'received_units', count(rmi.id) FILTER (WHERE rmi.received_back_at IS NOT NULL)::int,
        'skus', COALESCE((
          SELECT json_agg(sku_row ORDER BY sku_row->>'name')
          FROM (
            SELECT json_build_object(
              'sku_id', mi.sku_id,
              'sku_code', s.sku_code,
              'name', s.name,
              'pending', count(*) FILTER (WHERE rmi2.received_back_at IS NULL)::int,
              'received', count(*) FILTER (WHERE rmi2.received_back_at IS NOT NULL)::int
            ) AS sku_row
            FROM public.return_manifest_items rmi2
            JOIN public.material_instances mi ON mi.id = rmi2.material_instance_id
            JOIN public.skus s ON s.id = mi.sku_id
            WHERE rmi2.manifest_id = rm.id
            GROUP BY mi.sku_id, s.sku_code, s.name
          ) sku_sub
        ), '[]'::json)
      ) AS row
      FROM public.return_manifests rm
      JOIN public.cruise_ship_pos c ON c.id = rm.cspo_id
      JOIN public.vessels v ON v.id = c.vessel_id
      LEFT JOIN public.return_manifest_items rmi ON rmi.manifest_id = rm.id
      WHERE rm.org_id = v_org_id
        AND rm.status IN ('ready', 'picked_up')
      GROUP BY rm.id, rm.status, rm.freight_company, rm.created_at, c.id, c.cspo_number, v.name
    ) sub
  ), '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_onboard_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_return_restock_jobs() TO authenticated;

NOTIFY pgrst, 'reload schema';
