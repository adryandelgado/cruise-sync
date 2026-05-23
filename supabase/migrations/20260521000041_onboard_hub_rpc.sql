-- ============================================================================
-- ShipSync — Onboard hub (job list for receive / log / returns)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_onboard_hub()
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
    'jobs', public.list_onboard_jobs()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_onboard_hub() TO authenticated;

NOTIFY pgrst, 'reload schema';
