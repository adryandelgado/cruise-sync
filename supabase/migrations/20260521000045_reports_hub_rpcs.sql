-- ============================================================================
-- ShipSync — Reports overview + list RPCs (org-scoped analytics)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_reports_overview()
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
    'pnl_count', (
      SELECT count(*)::int
      FROM public.cspo_closure_report r
      WHERE r.org_id = v_org_id
        AND r.status <> 'cancelled'
    ),
    'transfer_count', (
      SELECT count(*)::int
      FROM public.transfer_audit t
      WHERE t.org_id = v_org_id
    ),
    'vessel_count', (
      SELECT count(*)::int
      FROM public.vessel_lifetime_spend v
      WHERE v.org_id = v_org_id
    ),
    'fleet_count', (
      SELECT count(*)::int
      FROM public.fleet_comparison f
      WHERE f.org_id = v_org_id
    ),
    'sku_count', (
      SELECT count(*)::int
      FROM public.sku_consumption_report s
      WHERE s.org_id = v_org_id
    ),
    'procurement_lag_count', (
      SELECT count(*)::int
      FROM public.procurement_lag_report p
      WHERE p.org_id = v_org_id
    ),
    'bookkeeper_count', (
      SELECT count(*)::int
      FROM (
        SELECT p.id
        FROM public.cspo_closure_report r
        JOIN public.cruise_ship_pos c ON c.id = r.cspo_id
        JOIN public.profiles p ON p.id = c.assigned_bookkeeper
        WHERE c.org_id = v_org_id
          AND c.assigned_bookkeeper IS NOT NULL
        GROUP BY p.id
      ) bk
    ),
    'audit_count', (
      SELECT count(*)::int
      FROM public.audit_events a
      WHERE a.org_id = v_org_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_cspo_pnl_report()
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
    SELECT json_agg(row ORDER BY row->>'cspo_number')
    FROM (
      SELECT to_jsonb(r.*) AS row
      FROM public.cspo_closure_report r
      WHERE r.org_id = v_org_id
        AND r.status <> 'cancelled'
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_transfer_audit(p_limit int DEFAULT 100)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_limit  int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_limit := greatest(1, least(coalesce(p_limit, 100), 500));

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'initiated_at' DESC)
    FROM (
      SELECT to_jsonb(t.*) AS row
      FROM public.transfer_audit t
      WHERE t.org_id = v_org_id
      ORDER BY t.initiated_at DESC
      LIMIT v_limit
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_audit_events(p_limit int DEFAULT 50)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_limit  int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'occurred_at' DESC)
    FROM (
      SELECT json_build_object(
        'id', a.id,
        'table_name', a.table_name,
        'record_id', a.record_id,
        'action', a.action,
        'occurred_at', a.occurred_at,
        'actor_id', a.actor_id
      ) AS row
      FROM public.audit_events a
      WHERE a.org_id = v_org_id
      ORDER BY a.occurred_at DESC
      LIMIT v_limit
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_vessel_spend_report()
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
    SELECT json_agg(row ORDER BY (row->>'total_issued_value')::numeric DESC)
    FROM (
      SELECT to_jsonb(v.*) AS row
      FROM public.vessel_lifetime_spend v
      WHERE v.org_id = v_org_id
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_fleet_comparison_report()
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
    SELECT json_agg(row ORDER BY (row->>'cspo_count')::int DESC)
    FROM (
      SELECT to_jsonb(f.*) AS row
      FROM public.fleet_comparison f
      WHERE f.org_id = v_org_id
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_sku_consumption_report()
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
    SELECT json_agg(row ORDER BY (row->>'qty_consumed')::numeric DESC)
    FROM (
      SELECT to_jsonb(s.*) AS row
      FROM public.sku_consumption_report s
      WHERE s.org_id = v_org_id
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_procurement_lag_report(p_limit int DEFAULT 50)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_limit  int;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'requested_at' DESC)
    FROM (
      SELECT to_jsonb(p.*) AS row
      FROM public.procurement_lag_report p
      WHERE p.org_id = v_org_id
      ORDER BY p.requested_at DESC
      LIMIT v_limit
    ) sub
  ), '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reports_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_cspo_pnl_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_transfer_audit(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_audit_events(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_vessel_spend_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_fleet_comparison_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_sku_consumption_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_procurement_lag_report(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
