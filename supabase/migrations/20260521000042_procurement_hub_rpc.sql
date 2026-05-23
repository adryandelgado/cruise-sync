-- ============================================================================
-- ShipSync — Procurement hub (open requests + queue summary)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_procurement_hub()
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

  RETURN json_build_object(
    'requests', COALESCE((
      SELECT json_agg(row ORDER BY row->>'created_at' DESC)
      FROM (
        SELECT json_build_object(
          'id', pr.id,
          'qty_needed', pr.qty_needed,
          'qty_received', pr.qty_received,
          'status', pr.status,
          'needed_by', pr.needed_by,
          'notes', pr.notes,
          'created_at', pr.created_at,
          'sku', json_build_object(
            'id', s.id,
            'sku_code', s.sku_code,
            'name', s.name
          ),
          'cspo', CASE
            WHEN c.id IS NOT NULL THEN json_build_object('cspo_number', c.cspo_number)
            ELSE NULL
          END,
          'supplier', CASE
            WHEN sup.id IS NOT NULL THEN json_build_object('name', sup.name)
            ELSE NULL
          END
        ) AS row
        FROM public.procurement_requests pr
        JOIN public.skus s ON s.id = pr.sku_id
        LEFT JOIN public.cruise_ship_pos c ON c.id = pr.cspo_id
        LEFT JOIN public.suppliers sup ON sup.id = pr.supplier_id
        WHERE pr.org_id = v_org_id
          AND pr.status IN ('open', 'partial', 'ordered')
      ) sub
    ), '[]'::json),
    'summary', (
      SELECT json_build_object(
        'open_count', count(*)::int,
        'pending_units', coalesce(
          sum(greatest(pr.qty_needed - pr.qty_received, 0)),
          0
        )
      )
      FROM public.procurement_requests pr
      WHERE pr.org_id = v_org_id
        AND pr.status IN ('open', 'partial', 'ordered')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_procurement_hub() TO authenticated;

NOTIFY pgrst, 'reload schema';
