-- ============================================================================
-- ShipSync — Sync material lists stuck in packing after CSPO shipped
-- Safe to re-run.
-- ============================================================================

-- Lists left in an active packing status after the CSPO already moved on.
UPDATE public.material_lists ml
SET status = 'complete'::public.material_list_status
FROM public.cruise_ship_pos c
WHERE ml.cspo_id = c.id
  AND ml.status IN (
    'submitted',
    'in_packing',
    'partially_packed',
    'awaiting_procurement'
  )
  AND c.status IN ('in_transit', 'on_vessel', 'in_progress', 'closing', 'closed')
  AND NOT EXISTS (
    SELECT 1
    FROM public.material_list_items mli
    WHERE mli.list_id = ml.id
      AND mli.packed_qty < mli.requested_qty
  );

NOTIFY pgrst, 'reload schema';
