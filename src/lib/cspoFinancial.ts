export type CspoFinancialSummary = {
  open_balance: number;
  consumed_value: number;
  installed_value: number;
  returned_value: number;
  transferred_out_value: number;
  transferred_in_value: number;
  written_off_value: number;
  adjusted_value: number;
  items_on_vessel: number;
  has_initial_ledger: boolean;
};

export function buildFinancialSummary(
  entries: Array<{ entry_type: string; amount: number }>,
  itemsOnVessel: number,
): CspoFinancialSummary {
  let open_balance = 0;
  let consumed_value = 0;
  let installed_value = 0;
  let returned_value = 0;
  let transferred_out_value = 0;
  let transferred_in_value = 0;
  let written_off_value = 0;
  let adjusted_value = 0;
  let has_initial_ledger = false;

  for (const e of entries) {
    const amt = Number(e.amount);
    open_balance += amt;
    switch (e.entry_type) {
      case "initial":
        has_initial_ledger = true;
        break;
      case "consumed":
        consumed_value += -amt;
        break;
      case "installed":
        installed_value += -amt;
        break;
      case "returned":
        returned_value += -amt;
        break;
      case "transferred_out":
        transferred_out_value += -amt;
        break;
      case "transferred_in":
        transferred_in_value += amt;
        break;
      case "written_off":
        written_off_value += -amt;
        break;
      case "adjusted":
        adjusted_value += amt;
        break;
    }
  }

  return {
    open_balance,
    consumed_value,
    installed_value,
    returned_value,
    transferred_out_value,
    transferred_in_value,
    written_off_value,
    adjusted_value,
    items_on_vessel: itemsOnVessel,
    has_initial_ledger,
  };
}

export const CSPO_FINANCIAL_QUERY_KEY = "cspo-financial-summary";

export type LedgerEntryRow = {
  id: string;
  entry_type: string;
  amount: number;
  notes: string | null;
  occurred_at: string;
  material_instance: {
    sku: { sku_code: string; name: string } | null;
  } | null;
};

export type AggregatedLedgerEntry = {
  id: string;
  entry_type: string;
  amount: number;
  qty: number;
  unit_amount: number;
  occurred_at: string;
  sku_code: string;
  sku_name: string | null;
  notes: string | null;
};

/** Collapse identical per-instance ledger rows into qty batches. */
export function aggregateLedgerEntries(entries: LedgerEntryRow[]): AggregatedLedgerEntry[] {
  const result: AggregatedLedgerEntry[] = [];

  for (const e of entries) {
    const sku = e.material_instance?.sku ?? null;
    const skuCode = sku?.sku_code ?? e.notes ?? "—";
    const unitAmount = Number(e.amount);
    const minute = e.occurred_at.slice(0, 16);
    const last = result[result.length - 1];

    if (
      last &&
      last.entry_type === e.entry_type &&
      last.sku_code === skuCode &&
      last.unit_amount === unitAmount &&
      last.notes === (e.notes ?? null) &&
      last.occurred_at.slice(0, 16) === minute
    ) {
      last.qty += 1;
      last.amount += unitAmount;
    } else {
      result.push({
        id: e.id,
        entry_type: e.entry_type,
        amount: unitAmount,
        qty: 1,
        unit_amount: unitAmount,
        occurred_at: e.occurred_at,
        sku_code: skuCode,
        sku_name: sku?.name ?? null,
        notes: e.notes,
      });
    }
  }

  return result;
}
