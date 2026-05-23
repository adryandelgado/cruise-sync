-- ============================================================================
-- ShipSync — add_return_manifest_item cache payload
-- Safe to re-run. Return type changes void → json (DROP first).
-- ============================================================================

DROP FUNCTION IF EXISTS public.add_return_manifest_item(
  uuid, uuid, public.return_item_condition, uuid
);

CREATE OR REPLACE FUNCTION public.add_return_manifest_item(
  p_manifest_id   uuid,
  p_instance_id   uuid,
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
  v_manifest  public.return_manifests%ROWTYPE;
  v_instance  public.material_instances%ROWTYPE;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE id = p_manifest_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Return manifest not found'; END IF;
  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'Manifest is not editable';
  END IF;

  SELECT * INTO v_instance
  FROM public.material_instances
  WHERE id = p_instance_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Material instance not found'; END IF;
  IF v_instance.status <> 'on_vessel' THEN
    RAISE EXCEPTION 'Only on_vessel items can be returned (current: %)', v_instance.status;
  END IF;
  IF v_instance.current_cspo_id IS DISTINCT FROM v_manifest.cspo_id THEN
    RAISE EXCEPTION 'Instance belongs to a different CSPO';
  END IF;

  INSERT INTO public.return_manifest_items (
    org_id, manifest_id, material_instance_id, condition
  ) VALUES (
    v_org_id, p_manifest_id, p_instance_id, p_condition
  );

  RETURN json_build_object(
    'instance_id', p_instance_id,
    'sku_id', v_instance.sku_id,
    'sku_code', (SELECT s.sku_code FROM public.skus s WHERE s.id = v_instance.sku_id),
    'sku_name', (SELECT s.name FROM public.skus s WHERE s.id = v_instance.sku_id),
    'on_manifest', (
      SELECT count(*)::int
      FROM public.return_manifest_items rmi
      JOIN public.material_instances mi ON mi.id = rmi.material_instance_id
      WHERE rmi.manifest_id = p_manifest_id
        AND mi.sku_id = v_instance.sku_id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_return_manifest_item(
  uuid, uuid, public.return_item_condition, uuid
) TO authenticated;

NOTIFY pgrst, 'reload schema';
