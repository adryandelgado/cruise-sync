export type InstanceRow = {
  id: string;
  status: string;
  sku: { sku_code: string; name: string } | null;
  cspo: { cspo_number: string } | null;
  location: { name: string; code: string } | null;
};

export type SkuInstanceSummary = {
  sku_code: string;
  name: string;
  qty: number;
  statuses: string[];
};

export function groupInstancesBySku(instances: InstanceRow[]): SkuInstanceSummary[] {
  const bySku = new Map<string, SkuInstanceSummary>();

  for (const inst of instances) {
    const code = inst.sku?.sku_code ?? inst.id.slice(0, 8);
    const existing = bySku.get(code);
    if (existing) {
      existing.qty += 1;
      if (!existing.statuses.includes(inst.status)) existing.statuses.push(inst.status);
    } else {
      bySku.set(code, {
        sku_code: code,
        name: inst.sku?.name ?? "Unknown",
        qty: 1,
        statuses: [inst.status],
      });
    }
  }

  return [...bySku.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterInstances(instances: InstanceRow[], query: string): InstanceRow[] {
  const q = query.trim().toUpperCase();
  if (!q) return instances;
  return instances.filter((inst) => {
    const code = inst.sku?.sku_code?.toUpperCase() ?? "";
    const name = inst.sku?.name?.toUpperCase() ?? "";
    const cspo = inst.cspo?.cspo_number?.toUpperCase() ?? "";
    return code.includes(q) || name.includes(q) || cspo.includes(q);
  });
}
