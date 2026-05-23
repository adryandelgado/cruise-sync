-- ============================================================================
-- ShipSync — Warehouse hub (pack jobs + return restock summary)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_warehouse_hub()
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
    'pack_jobs', public.list_pack_jobs(),
    'restock', COALESCE((
      SELECT json_build_object(
        'manifest_count', count(*)::int,
        'pending_units', coalesce(sum(m.pending_units), 0)::int
      )
      FROM (
        SELECT
          count(rmi.id) FILTER (WHERE rmi.received_back_at IS NULL)::int AS pending_units
        FROM public.return_manifests rm
        LEFT JOIN public.return_manifest_items rmi ON rmi.manifest_id = rm.id
        WHERE rm.org_id = v_org_id
          AND rm.status IN ('ready', 'picked_up')
        GROUP BY rm.id
      ) m
    ), json_build_object('manifest_count', 0, 'pending_units', 0))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_warehouse_hub() TO authenticated;

NOTIFY pgrst, 'reload schema';
