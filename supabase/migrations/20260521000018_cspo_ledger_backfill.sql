-- ============================================================================
-- ShipSync — Backfill missing initial ledger rows (financial summary sync)
-- Safe to re-run.
-- ============================================================================

INSERT INTO public.cspo_value_ledger (
  org_id, cspo_id, entry_type, amount, currency, notes
)
SELECT
  c.org_id,
  c.id,
  'initial'::public.cspo_ledger_entry,
  c.original_value,
  c.currency,
  'Backfill: initial PO value'
FROM public.cruise_ship_pos c
WHERE c.original_value > 0
  AND c.status NOT IN ('cancelled')
  AND NOT EXISTS (
    SELECT 1
    FROM public.cspo_value_ledger l
    WHERE l.cspo_id = c.id
      AND l.entry_type = 'initial'::public.cspo_ledger_entry
  );

NOTIFY pgrst, 'reload schema';
