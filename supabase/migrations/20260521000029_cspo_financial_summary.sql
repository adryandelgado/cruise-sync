-- ============================================================================
-- ShipSync — CSPO financial summary (ledger + aboard count, single query)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cspo_financial_summary(p_cspo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_items  int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  SELECT count(*)::int INTO v_items
  FROM public.material_instances
  WHERE org_id = v_org_id
    AND current_cspo_id = p_cspo_id
    AND status = 'on_vessel';

  RETURN json_build_object(
    'items_on_vessel', v_items,
    'entries', COALESCE((
      SELECT json_agg(row ORDER BY row->>'occurred_at')
      FROM (
        SELECT json_build_object(
          'id', l.id,
          'entry_type', l.entry_type,
          'amount', l.amount,
          'notes', l.notes,
          'occurred_at', l.occurred_at,
          'material_instance', CASE
            WHEN s.id IS NOT NULL THEN json_build_object(
              'sku', json_build_object(
                'sku_code', s.sku_code,
                'name', s.name
              )
            )
            ELSE NULL
          END
        ) AS row
        FROM public.cspo_value_ledger l
        LEFT JOIN public.material_instances mi ON mi.id = l.material_instance_id
        LEFT JOIN public.skus s ON s.id = mi.sku_id
        WHERE l.cspo_id = p_cspo_id
          AND l.org_id = v_org_id
        ORDER BY l.occurred_at
      ) sub
    ), '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cspo_financial_summary(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
