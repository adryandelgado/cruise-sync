-- ============================================================================
-- ShipSync — Material instance lifetime trace RPC (org-scoped)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_material_trace(p_material_instance_id uuid)
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

  IF p_material_instance_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.material_instances mi
    WHERE mi.id = p_material_instance_id
      AND mi.org_id = v_org_id
  ) THEN
    RETURN '[]'::json;
  END IF;

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'occurred_at')
    FROM (
      SELECT json_build_object(
        'movement_id', l.movement_id,
        'material_instance_id', l.material_instance_id,
        'sku_code', l.sku_code,
        'sku_name', l.sku_name,
        'from_status', l.from_status,
        'to_status', l.to_status,
        'cspo_id', l.cspo_id,
        'cspo_number', l.cspo_number,
        'reason_code', l.reason_code,
        'notes', l.notes,
        'occurred_at', l.occurred_at
      ) AS row
      FROM public.material_lifetime_log l
      WHERE l.org_id = v_org_id
        AND l.material_instance_id = p_material_instance_id
      ORDER BY l.occurred_at ASC
    ) sub
  ), '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_material_trace(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
