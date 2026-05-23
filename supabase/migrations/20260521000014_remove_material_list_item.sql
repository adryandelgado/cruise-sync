-- ============================================================================
-- ShipSync — Remove material list items (incl. custom-only packed lines)
-- Safe to re-run.
-- ============================================================================

-- Clear CSPO/package cache when instances return to warehouse stock.
CREATE OR REPLACE FUNCTION public.sync_material_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.material_instances
  SET status              = NEW.to_status,
      current_location_id = NEW.to_location_id,
      current_cspo_id     = CASE
        WHEN NEW.to_status = 'in_stock'::public.material_status THEN NULL
        ELSE COALESCE(NEW.cspo_id, current_cspo_id)
      END,
      current_package_id  = CASE
        WHEN NEW.to_status = 'in_stock'::public.material_status THEN NULL
        ELSE COALESCE(NEW.package_id, current_package_id)
      END
  WHERE id = NEW.material_instance_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_material_list_item(
  p_item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id    uuid;
  v_item      public.material_list_items%ROWTYPE;
  v_pc        record;
  v_status    public.material_status;
  v_cspo_id   uuid;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_item
  FROM public.material_list_items
  WHERE id = p_item_id AND org_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'List item not found'; END IF;

  IF v_item.status = 'procuring'::public.material_list_item_status THEN
    RAISE EXCEPTION 'Cancel or complete procurement before removing this line';
  END IF;

  SELECT ml.cspo_id INTO v_cspo_id
  FROM public.material_lists ml
  WHERE ml.id = v_item.list_id;

  FOR v_pc IN
    SELECT pc.id, pc.material_instance_id, pc.package_id
    FROM public.package_contents pc
    WHERE pc.list_item_id = p_item_id
      AND pc.org_id = v_org_id
  LOOP
    IF v_pc.material_instance_id IS NULL THEN
      DELETE FROM public.package_contents WHERE id = v_pc.id;
      CONTINUE;
    END IF;

    SELECT status INTO v_status
    FROM public.material_instances
    WHERE id = v_pc.material_instance_id
    FOR UPDATE;

    IF v_status = 'packed'::public.material_status THEN
      INSERT INTO public.inventory_movements (
        org_id, material_instance_id, to_status,
        cspo_id, package_id, performed_by, notes
      ) VALUES (
        v_org_id, v_pc.material_instance_id, 'in_stock',
        NULL, NULL, auth.uid(), 'Removed from material list — returned to stock'
      );
      DELETE FROM public.package_contents WHERE id = v_pc.id;
    ELSIF v_status = 'in_stock'::public.material_status THEN
      DELETE FROM public.package_contents WHERE id = v_pc.id;
    ELSE
      RAISE EXCEPTION
        'Cannot remove: item is already % (must be in warehouse or packed only)',
        v_status;
    END IF;
  END LOOP;

  DELETE FROM public.material_list_items WHERE id = p_item_id;

  IF v_cspo_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.material_list_items mli
      JOIN public.material_lists ml ON ml.id = mli.list_id
      WHERE ml.cspo_id = v_cspo_id
        AND mli.packed_qty < mli.requested_qty
    ) THEN
      UPDATE public.material_lists ml
      SET status = 'in_packing'::public.material_list_status
      WHERE ml.cspo_id = v_cspo_id
        AND ml.status = 'complete'::public.material_list_status;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_material_list_item(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
