export type SalesQuoteRow = {
  id: string;
  quote_number: string;
  total: number;
  currency: string;
  status: string;
  valid_until: string | null;
  created_at: string;
  vessel: unknown;
};

export function salesQuoteVesselName(quote: SalesQuoteRow): string {
  const vessel = quote.vessel as { name?: string; fleet?: { name?: string } | null } | null;
  return vessel?.name ?? "—";
}

export function salesQuoteFleetName(quote: SalesQuoteRow): string | undefined {
  const vessel = quote.vessel as { fleet?: { name?: string } | null } | null;
  return vessel?.fleet?.name;
}

export const SALES_QUOTE_STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "draft", label: "Draft" },
  { id: "sent", label: "Sent" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "expired", label: "Expired" },
] as const;

export function salesQuoteBadgeVariant(status: string) {
  switch (status) {
    case "accepted":
      return "on_vessel" as const;
    case "sent":
      return "active" as const;
    case "rejected":
    case "expired":
      return "cancelled" as const;
    default:
      return "draft" as const;
  }
}

export function filterSalesQuotes(
  quotes: SalesQuoteRow[],
  search: string,
  statusFilter: string,
): SalesQuoteRow[] {
  const q = search.trim().toUpperCase();
  return quotes.filter((quote) => {
    if (statusFilter && quote.status !== statusFilter) return false;
    if (!q) return true;
    const vessel = quote.vessel as { name?: string; fleet?: { name?: string } | null } | null;
    const vesselName = vessel?.name?.toUpperCase() ?? "";
    const fleet = vessel?.fleet?.name?.toUpperCase() ?? "";
    return (
      quote.quote_number.toUpperCase().includes(q) ||
      vesselName.includes(q) ||
      fleet.includes(q)
    );
  });
}
