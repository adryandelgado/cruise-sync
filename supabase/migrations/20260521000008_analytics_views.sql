-- ============================================================================
-- ShipSync — Analytics report views (Phase 7 / blueprint §11)
-- ============================================================================

CREATE OR REPLACE VIEW public.vessel_lifetime_spend AS
SELECT
  v.id AS vessel_id,
  v.org_id,
  v.name AS vessel_name,
  f.name AS fleet_name,
  count(DISTINCT c.id) AS cspo_count,
  COALESCE(sum(c.original_value) FILTER (WHERE c.status <> 'cancelled'), 0) AS total_issued_value,
  COALESCE(sum(s.consumed_value + s.installed_value), 0) AS total_consumed_value,
  COALESCE(sum(s.open_balance) FILTER (WHERE c.status NOT IN ('closed', 'cancelled')), 0) AS total_open_balance
FROM public.vessels v
LEFT JOIN public.fleets f ON f.id = v.fleet_id
LEFT JOIN public.cruise_ship_pos c ON c.vessel_id = v.id
LEFT JOIN public.cspo_live_summary s ON s.cspo_id = c.id
GROUP BY v.id, f.name;

CREATE OR REPLACE VIEW public.fleet_comparison AS
SELECT
  f.id AS fleet_id,
  f.org_id,
  f.name AS fleet_name,
  count(DISTINCT v.id) AS vessel_count,
  count(DISTINCT c.id) AS cspo_count,
  COALESCE(avg(c.original_value) FILTER (WHERE c.status = 'closed'), 0) AS avg_closed_job_value,
  COALESCE(avg(s.variance_pct) FILTER (WHERE c.status = 'closed'), 0) AS avg_variance_pct,
  COALESCE(
    avg(
      CASE WHEN c.original_value > 0
        THEN s.returned_value / c.original_value * 100
        ELSE 0 END
    ) FILTER (WHERE c.status = 'closed'),
    0
  ) AS avg_return_rate_pct,
  (
    SELECT count(*) FROM public.transfer_events t
    WHERE t.org_id = f.org_id
      AND EXISTS (
        SELECT 1 FROM public.cruise_ship_pos cp
        JOIN public.vessels vv ON vv.id = cp.vessel_id
        WHERE cp.id = t.from_cspo_id AND vv.fleet_id = f.id
      )
  ) AS transfer_count
FROM public.fleets f
LEFT JOIN public.vessels v ON v.fleet_id = f.id
LEFT JOIN public.cruise_ship_pos c ON c.vessel_id = v.id
LEFT JOIN public.cspo_closure_report s ON s.cspo_id = c.id
GROUP BY f.id;

CREATE OR REPLACE VIEW public.sku_consumption_report AS
SELECT
  s.org_id,
  s.id AS sku_id,
  s.sku_code,
  s.name AS sku_name,
  s.category,
  count(ul.id) FILTER (WHERE ul.action_type = 'consumed') AS consume_events,
  count(ul.id) FILTER (WHERE ul.action_type = 'installed') AS install_events,
  COALESCE(sum(ul.qty) FILTER (WHERE ul.action_type = 'consumed'), 0) AS qty_consumed,
  COALESCE(sum(ul.qty) FILTER (WHERE ul.action_type = 'installed'), 0) AS qty_installed,
  count(rmi.id) AS return_count
FROM public.skus s
LEFT JOIN public.material_instances mi ON mi.sku_id = s.id
LEFT JOIN public.usage_logs ul ON ul.material_instance_id = mi.id
LEFT JOIN public.return_manifest_items rmi ON rmi.material_instance_id = mi.id
WHERE s.active = true
GROUP BY s.id;

CREATE OR REPLACE VIEW public.procurement_lag_report AS
SELECT
  pr.org_id,
  pr.id AS request_id,
  pr.status,
  pr.created_at AS requested_at,
  pr.needed_by,
  sk.sku_code,
  sk.name AS sku_name,
  c.cspo_number,
  EXTRACT(day FROM (
    COALESCE(
      (SELECT min(po.ordered_at) FROM public.purchase_order_lines pol
       JOIN public.purchase_orders po ON po.id = pol.po_id
       WHERE pol.procurement_request_id = pr.id),
      CASE WHEN pr.status IN ('received', 'cancelled') THEN pr.updated_at END
    ) - pr.created_at
  ))::int AS lag_days
FROM public.procurement_requests pr
JOIN public.skus sk ON sk.id = pr.sku_id
LEFT JOIN public.cruise_ship_pos c ON c.id = pr.cspo_id;

GRANT SELECT ON
  public.vessel_lifetime_spend,
  public.fleet_comparison,
  public.sku_consumption_report,
  public.procurement_lag_report
TO authenticated;

NOTIFY pgrst, 'reload schema';
