-- ============================================================================
-- ShipSync — Onboard SKU inventory summary + bulk return restock
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.onboard_sku_inventory(p_cspo_id uuid)
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

  RETURN COALESCE((
    SELECT json_agg(row ORDER BY row->>'name')
    FROM (
      SELECT json_build_object(
        'sku_id', mi.sku_id,
        'sku_code', s.sku_code,
        'name', s.name,
        'unit_of_measure', s.unit_of_measure,
        'aboard', count(*)::int,
        'on_manifest', count(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM public.return_manifest_items rmi
            JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
            WHERE rmi.material_instance_id = mi.id
              AND rm.cspo_id = p_cspo_id
              AND rm.status = 'draft'
          )
        )::int,
        'available', count(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM public.return_manifest_items rmi
            JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
            WHERE rmi.material_instance_id = mi.id
              AND rm.cspo_id = p_cspo_id
              AND rm.status = 'draft'
          )
        )::int
      ) AS row
      FROM public.material_instances mi
      JOIN public.skus s ON s.id = mi.sku_id
      WHERE mi.org_id = v_org_id
        AND mi.current_cspo_id = p_cspo_id
        AND mi.status = 'on_vessel'
      GROUP BY mi.sku_id, s.sku_code, s.name, s.unit_of_measure
    ) sub
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_return_sku_qty(
  p_manifest_id   uuid,
  p_sku_id        uuid,
  p_qty           numeric DEFAULT 1,
  p_condition     public.return_item_condition DEFAULT 'good',
  p_performed_by  uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_to_recv int;
  v_received int := 0;
  v_instance uuid;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  v_to_recv := FLOOR(p_qty)::int;

  FOR v_instance IN
    SELECT rmi.material_instance_id
    FROM public.return_manifest_items rmi
    JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
    JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
    WHERE rmi.manifest_id = p_manifest_id
      AND mi.sku_id = p_sku_id
      AND rmi.received_back_at IS NULL
      AND rm.org_id = public.current_org_id()
    ORDER BY rmi.created_at
    LIMIT v_to_recv
  LOOP
    PERFORM public.receive_return_item(
      v_instance, p_condition, NULL, p_performed_by
    );
    v_received := v_received + 1;
  END LOOP;

  IF v_received = 0 THEN
    RAISE EXCEPTION 'No pending return items for this SKU on the manifest';
  END IF;

  RETURN json_build_object(
    'received', v_received,
    'pending', (
      SELECT count(*)::int
      FROM public.return_manifest_items rmi
      JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
      WHERE rmi.manifest_id = p_manifest_id
        AND mi.sku_id = p_sku_id
        AND rmi.received_back_at IS NULL
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.onboard_sku_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_return_sku_qty(
  uuid, uuid, numeric, public.return_item_condition, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
