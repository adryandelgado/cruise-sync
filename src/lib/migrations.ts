/**
 * Single source of truth for Supabase SQL Editor instructions.
 * Shown in the app banner whenever schema is incomplete.
 */
export const ALL_MIGRATIONS = [
  { file: "20260520000001_init_schema.sql", label: "Core schema" },
  { file: "20260520000002_rls.sql", label: "Row Level Security" },
  { file: "20260520000003_dev_helpers.sql", label: "Health check" },
  { file: "20260521000001_proposals_and_material_lists.sql", label: "Proposals & material lists" },
  { file: "20260521000002_packing.sql", label: "Packing & shipping" },
  { file: "20260521000003_dev_pm_role.sql", label: "Dev PM role" },
  { file: "20260521000004_onboard_operations.sql", label: "Onboard ops" },
  { file: "20260521000005_procurement_and_sales.sql", label: "Procurement & sales" },
  { file: "20260521000006_closure_restock_audit.sql", label: "Closure & audit" },
  { file: "20260521000007_schema_diagnostics.sql", label: "Schema diagnostics" },
  { file: "20260521000008_analytics_views.sql", label: "Analytics reports" },
  { file: "20260521000009_health_check_fix.sql", label: "Health check fix" },
  { file: "20260521000010_onboard_workflow_fixes.sql", label: "Onboard fixes + demo CSPO" },
  { file: "20260521000011_procurement_fixes.sql", label: "Procurement workflow fixes" },
  { file: "20260521000012_procurement_receive_unblock.sql", label: "Procurement receive → warehouse" },
  { file: "20260521000013_supplemental_packing.sql", label: "Supplemental packing after empty receive" },
  { file: "20260521000014_remove_material_list_item.sql", label: "Remove material list items" },
  { file: "20260521000015_onboard_flow_fix.sql", label: "Onboard flow + demo repair" },
  { file: "20260521000016_receive_open_packages.sql", label: "Receive supplemental open packages" },
  { file: "20260521000017_transfer_closure_fix.sql", label: "Transfer custody + CSPO closure fix" },
  { file: "20260521000018_cspo_ledger_backfill.sql", label: "Backfill initial CSPO ledger rows" },
  { file: "20260521000019_return_closure_fix.sql", label: "Return custody + closure fix" },
  { file: "20260521000020_bulk_pack.sql", label: "Bulk pack RPC (pack_list_item_qty)" },
  { file: "20260521000021_sync_packed_lists.sql", label: "Sync packed lists after CSPO shipped" },
  { file: "20260521000022_complete_packing_enum_fix.sql", label: "Fix complete_packing cspo_status enum" },
  { file: "20260521000023_log_sku_usage_qty.sql", label: "Bulk SKU usage logging (daily log qty)" },
  { file: "20260521000024_return_transfer_sku_qty.sql", label: "Bulk return & transfer by SKU qty" },
  { file: "20260521000025_onboard_sku_inventory.sql", label: "Onboard SKU inventory + bulk restock" },
  { file: "20260521000026_job_summary_rpcs.sql", label: "Onboard jobs + restock summary RPCs" },
  { file: "20260521000027_pack_and_blocker_rpcs.sql", label: "Pack job queue + blocking inventory RPCs" },
  { file: "20260521000028_cspo_workflow_summary.sql", label: "CSPO workflow banner summary RPC" },
  { file: "20260521000029_cspo_financial_summary.sql", label: "CSPO financial summary RPC" },
  { file: "20260521000030_pack_session_rpc.sql", label: "Warehouse pack session RPC" },
  { file: "20260521000031_receive_session_rpc.sql", label: "Onboard receive session RPC" },
  { file: "20260521000032_usage_log_session_rpc.sql", label: "Daily usage log session RPC" },
  { file: "20260521000033_returns_session_rpc.sql", label: "Returns & transfers session RPC" },
  { file: "20260521000034_ledger_amounts_in_bulk_rpcs.sql", label: "Ledger amounts in bulk onboard RPCs" },
  { file: "20260521000035_cspo_detail_session_rpc.sql", label: "CSPO detail session RPC" },
  { file: "20260521000036_return_restock_receipt_fix.sql", label: "Return restock receipt fix" },
  { file: "20260521000037_sync_cspo_aboard_status.sql", label: "Sync CSPO status when aboard cleared" },
  { file: "20260521000038_dashboard_stats_rpc.sql", label: "Dashboard stats RPC" },
  { file: "20260521000039_list_cspos_rpc.sql", label: "CSPO list RPC" },
  { file: "20260521000040_warehouse_hub_rpc.sql", label: "Warehouse hub RPC" },
  { file: "20260521000041_onboard_hub_rpc.sql", label: "Onboard hub RPC" },
  { file: "20260521000042_procurement_hub_rpc.sql", label: "Procurement hub RPC" },
  { file: "20260521000043_inventory_hub_rpc.sql", label: "Inventory catalog + instances RPCs" },
  { file: "20260521000044_sku_list_and_reports_rpcs.sql", label: "SKU list + reports RPCs" },
  { file: "20260521000045_reports_hub_rpcs.sql", label: "Reports overview + list RPCs" },
  { file: "20260521000046_material_trace_rpc.sql", label: "Material trace RPC" },
  { file: "20260521000047_rpc_cache_payloads.sql", label: "RPC cache payloads (procurement, transfer, return)" },
  { file: "20260521000048_onboard_rpc_cache_payloads.sql", label: "Onboard RPC cache payloads (usage, transfer, ack)" },
  { file: "20260521000049_receive_package_cache_payload.sql", label: "Receive package cache payload + transfer sku context" },
  { file: "20260521000050_add_return_item_cache_payload.sql", label: "Add return manifest item cache payload" },
  { file: "20260521000051_fix_cspo_blocking_summary.sql", label: "Fix CSPO blocking summary statuses cast" },
  { file: "20260521000052_fix_cspo_blocking_summary_json.sql", label: "Fix CSPO blocking summary json_agg statuses" },
] as const;

export function migrationPath(file: string) {
  return `supabase/migrations/${file}`;
}

/** Migrations likely still needed based on table count (when schema_status unavailable). */
export function migrationsFromTableCount(found: number): string[] {
  if (found >= 32) return [];
  if (found >= 29) return ALL_MIGRATIONS.slice(8, 11).map((m) => m.file);
  if (found >= 24) return ALL_MIGRATIONS.slice(7, 10).map((m) => m.file);
  if (found >= 19) return ALL_MIGRATIONS.slice(6, 10).map((m) => m.file);
  if (found >= 15) return ALL_MIGRATIONS.slice(4, 10).map((m) => m.file);
  if (found >= 11) return ALL_MIGRATIONS.slice(3, 10).map((m) => m.file);
  return ALL_MIGRATIONS.slice(0, 3).map((m) => m.file);
}

export const SEED_FILE = "supabase/seed.sql";
