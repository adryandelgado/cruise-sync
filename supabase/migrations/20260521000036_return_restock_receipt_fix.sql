-- ============================================================================
-- ShipSync — Fix return restock receipt (manifest lookup + data repair)
-- Safe to re-run.
-- ============================================================================

-- Instances on sealed manifests must be status=returning before warehouse scan-in.
INSERT INTO public.inventory_movements (
  org_id, material_instance_id, to_status,
  cspo_id, performed_by, notes
)
SELECT
  mi.org_id,
  mi.id,
  'returning'::public.material_status,
  NULL,
  rm.created_by,
  'Repair: return manifest sealed without status transition'
FROM public.return_manifest_items rmi
JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
WHERE rm.status IN ('ready', 'picked_up')
  AND mi.status = 'on_vessel'::public.material_status
  AND rmi.received_back_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_movements m
    WHERE m.material_instance_id = mi.id
      AND m.to_status = 'returning'::public.material_status
  );

DROP FUNCTION IF EXISTS public.receive_return_item(
  uuid, public.return_item_condition, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.receive_return_item(
  p_instance_id   uuid,
  p_condition     public.return_item_condition DEFAULT 'good',
  p_location_id   uuid DEFAULT NULL,
  p_performed_by  uuid DEFAULT auth.uid(),
  p_manifest_id   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id     uuid;
  v_instance   public.material_instances%ROWTYPE;
  v_item       public.return_manifest_items%ROWTYPE;
  v_manifest   public.return_manifests%ROWTYPE;
  v_loc_id     uuid;
  v_to_status  public.material_status;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_instance
  FROM public.material_instances
  WHERE id = p_instance_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Instance not found'; END IF;
  IF v_instance.status <> 'returning' THEN
    RAISE EXCEPTION 'Instance must be returning (current: %)', v_instance.status;
  END IF;

  SELECT rmi.*
  INTO v_item
  FROM public.return_manifest_items rmi
  JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
  WHERE rmi.material_instance_id = p_instance_id
    AND rmi.org_id = v_org_id
    AND rm.status IN ('ready', 'picked_up')
    AND rmi.received_back_at IS NULL
    AND (p_manifest_id IS NULL OR rmi.manifest_id = p_manifest_id)
  ORDER BY rm.created_at DESC, rmi.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Return manifest not open for receipt'; END IF;

  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE id = v_item.manifest_id
    AND org_id = v_org_id
    AND status IN ('ready', 'picked_up');

  IF NOT FOUND THEN RAISE EXCEPTION 'Return manifest not open for receipt'; END IF;

  v_loc_id := p_location_id;
  IF v_loc_id IS NULL THEN
    SELECT id INTO v_loc_id FROM public.locations
    WHERE org_id = v_org_id AND type = 'warehouse' LIMIT 1;
  END IF;

  v_to_status := CASE p_condition
    WHEN 'damaged' THEN 'damaged'::public.material_status
    WHEN 'needs_inspection' THEN 'inspecting'::public.material_status
    ELSE 'in_stock'::public.material_status
  END;

  INSERT INTO public.inventory_movements (
    org_id, material_instance_id, to_status,
    to_location_id, cspo_id, performed_by, notes, reason_code
  ) VALUES (
    v_org_id, p_instance_id, v_to_status,
    v_loc_id, v_manifest.cspo_id, p_performed_by,
    'Return received at warehouse', p_condition::text
  );

  UPDATE public.material_instances
  SET current_cspo_id = NULL, current_package_id = NULL
  WHERE id = p_instance_id;

  UPDATE public.return_manifest_items
  SET received_back_at = now(), condition = p_condition
  WHERE id = v_item.id;
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
  v_org_id    uuid;
  v_to_recv   int;
  v_received  int := 0;
  v_instance  uuid;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.return_manifests
    WHERE id = p_manifest_id
      AND org_id = v_org_id
      AND status IN ('ready', 'picked_up')
  ) THEN
    RAISE EXCEPTION 'Return manifest not open for receipt';
  END IF;

  v_to_recv := FLOOR(p_qty)::int;

  FOR v_instance IN
    SELECT rmi.material_instance_id
    FROM public.return_manifest_items rmi
    JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
    JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
    WHERE rmi.manifest_id = p_manifest_id
      AND mi.sku_id = p_sku_id
      AND mi.status = 'returning'::public.material_status
      AND rmi.received_back_at IS NULL
      AND rm.org_id = v_org_id
      AND rm.status IN ('ready', 'picked_up')
    ORDER BY rmi.created_at
    LIMIT v_to_recv
  LOOP
    PERFORM public.receive_return_item(
      v_instance, p_condition, NULL, p_performed_by, p_manifest_id
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

CREATE OR REPLACE FUNCTION public.add_return_sku_qty(
  p_manifest_id   uuid,
  p_cspo_id       uuid,
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
  v_to_add int;
  v_added  int := 0;
  v_instance uuid;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Qty must be positive'; END IF;

  v_to_add := FLOOR(p_qty)::int;

  FOR v_instance IN
    SELECT mi.id
    FROM public.material_instances mi
    WHERE mi.org_id = public.current_org_id()
      AND mi.current_cspo_id = p_cspo_id
      AND mi.sku_id = p_sku_id
      AND mi.status = 'on_vessel'
      AND NOT EXISTS (
        SELECT 1
        FROM public.return_manifest_items rmi
        JOIN public.return_manifests rm ON rm.id = rmi.manifest_id
        WHERE rmi.material_instance_id = mi.id
          AND rm.status IN ('draft', 'ready', 'picked_up')
          AND rmi.received_back_at IS NULL
      )
    ORDER BY mi.created_at
    LIMIT v_to_add
  LOOP
    PERFORM public.add_return_manifest_item(
      p_manifest_id, v_instance, p_condition, p_performed_by
    );
    v_added := v_added + 1;
  END LOOP;

  IF v_added = 0 THEN
    RAISE EXCEPTION 'No on-vessel instances available to add for this SKU';
  END IF;

  RETURN json_build_object(
    'added', v_added,
    'on_manifest', (
      SELECT count(*)::int
      FROM public.return_manifest_items rmi
      JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
      WHERE rmi.manifest_id = p_manifest_id
        AND mi.sku_id = p_sku_id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_return_item(
  uuid, public.return_item_condition, uuid, uuid, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.receive_return_sku_qty(
  uuid, uuid, numeric, public.return_item_condition, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.add_return_sku_qty(
  uuid, uuid, uuid, numeric, public.return_item_condition, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
