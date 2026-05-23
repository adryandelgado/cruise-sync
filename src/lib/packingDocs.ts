export type DocLineInput = {
  qty: number;
  description: string | null;
  material_instance: {
    sku: {
      sku_code: string;
      name: string;
      hts_code: string | null;
      default_cost: number | null;
    } | null;
  } | null;
};

export type DocLineRow = {
  key: string;
  sku_code: string;
  name: string;
  hts_code: string | null;
  qty: number;
  unit_cost: number;
  line_total: number;
  is_custom: boolean;
};

export function groupDocLinesBySku(contents: DocLineInput[]): DocLineRow[] {
  const byKey = new Map<string, DocLineRow>();

  for (const c of contents) {
    const sku = c.material_instance?.sku;
    const qty = Number(c.qty) || 1;
    const unitCost = Number(sku?.default_cost ?? 0);
    const key = sku
      ? `${sku.sku_code}|${sku.hts_code ?? ""}|${unitCost}`
      : `custom|${c.description ?? "?"}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.qty += qty;
      existing.line_total += unitCost * qty;
    } else {
      byKey.set(key, {
        key,
        sku_code: sku?.sku_code ?? "CUSTOM",
        name: sku?.name ?? c.description ?? "Custom item",
        hts_code: sku?.hts_code ?? null,
        qty,
        unit_cost: unitCost,
        line_total: unitCost * qty,
        is_custom: !sku,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function sumDocLines(lines: DocLineRow[]): number {
  return lines.reduce((sum, line) => sum + line.line_total, 0);
}

export type PackingListSkuRow = {
  sku_code: string;
  label: string;
  qty: number;
};

export function groupPackageContentsForList(contents: DocLineInput[]): PackingListSkuRow[] {
  return groupDocLinesBySku(contents).map((row) => ({
    sku_code: row.sku_code,
    label: row.is_custom ? row.name : `${row.sku_code} — ${row.name}`,
    qty: row.qty,
  }));
}
