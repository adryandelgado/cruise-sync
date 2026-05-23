-- ============================================================================
-- ShipSync — Bulk SKU packing (one RPC for many units)
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pack_list_item_qty(
  p_list_item_id uuid,
  p_package_id   uuid,
  p_qty          numeric DEFAULT 1,
  p_performed_by uuid DEFAULT auth.uid()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item       public.material_list_items%ROWTYPE;
  v_remaining  numeric;
  v_to_pack    int;
  v_packed     int := 0;
  v_i          int;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Qty must be positive';
  END IF;

  SELECT * INTO v_item
  FROM public.material_list_items
  WHERE id = p_list_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'List item not found'; END IF;

  v_remaining := GREATEST(v_item.requested_qty - v_item.packed_qty, 0);
  v_to_pack := LEAST(FLOOR(p_qty)::int, FLOOR(v_remaining)::int);

  IF v_to_pack = 0 THEN
    RETURN json_build_object('packed', 0, 'remaining', v_remaining);
  END IF;

  FOR v_i IN 1..v_to_pack LOOP
    BEGIN
      PERFORM public.pack_list_item_unit(p_list_item_id, p_package_id, p_performed_by);
      v_packed := v_packed + 1;
    EXCEPTION
      WHEN OTHERS THEN
        EXIT;
    END;
  END LOOP;

  SELECT GREATEST(requested_qty - packed_qty, 0) INTO v_remaining
  FROM public.material_list_items
  WHERE id = p_list_item_id;

  RETURN json_build_object(
    'packed', v_packed,
    'remaining', v_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pack_list_item_qty(uuid, uuid, numeric, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
