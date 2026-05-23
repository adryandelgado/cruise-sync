-- Fix get_cspo_blocking_summary statuses: use json_agg (json[]) not pg text[].

CREATE OR REPLACE FUNCTION public.get_cspo_blocking_summary(p_cspo_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_count int;
  v_groups json;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cruise_ship_pos
    WHERE id = p_cspo_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'CSPO not found';
  END IF;

  SELECT count(*)::int INTO v_count
  FROM public.material_instances mi
  WHERE mi.org_id = v_org_id
    AND mi.current_cspo_id = p_cspo_id
    AND mi.status = ANY (
      ARRAY[
        'on_vessel'::public.material_status,
        'packed'::public.material_status,
        'in_transit'::public.material_status,
        'allocated'::public.material_status
      ]
    );

  SELECT COALESCE(json_agg(g ORDER BY g->>'name'), '[]'::json) INTO v_groups
  FROM (
    SELECT json_build_object(
      'sku_code', s.sku_code,
      'name', s.name,
      'qty', count(*)::int,
      'statuses', COALESCE(json_agg(DISTINCT mi.status::text), '[]'::json)
    ) AS g
    FROM public.material_instances mi
    JOIN public.skus s ON s.id = mi.sku_id
    WHERE mi.org_id = v_org_id
      AND mi.current_cspo_id = p_cspo_id
      AND mi.status = ANY (
        ARRAY[
          'on_vessel'::public.material_status,
          'packed'::public.material_status,
          'in_transit'::public.material_status,
          'allocated'::public.material_status
        ]
      )
    GROUP BY mi.sku_id, s.sku_code, s.name
  ) sub;

  RETURN json_build_object(
    'blocker_count', v_count,
    'groups', COALESCE(v_groups, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cspo_blocking_summary(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
