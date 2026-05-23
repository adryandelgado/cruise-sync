/** Hub and session queries stay fresh via cache patches — avoid redundant refetches. */
export const LIVE_PATCHED_STALE_MS = 5 * 60_000;

/** Reference catalogs (vessels, SKU list) change less often during a shift. */
export const REFERENCE_STALE_MS = 10 * 60_000;
