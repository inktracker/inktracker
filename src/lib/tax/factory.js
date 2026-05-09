import { TAX_MODE } from "./taxProvider";
import { createInternalTaxProvider } from "./internalTaxProvider";
import { createQuickBooksTaxProvider } from "./quickbooksTaxProvider";

/**
 * taxProviderFor(shop, opts)
 *
 * Picks the right TaxProvider based on `shop.tax_mode`. Defaults to
 * 'internal' when the field is missing (e.g. a brand-new shop or a row
 * that hasn't been touched since the migration).
 *
 * `opts` are forwarded to the QuickBooks provider only:
 *   { qbSyncUrl, accessToken, httpClient }
 */
export function taxProviderFor(shop, opts = {}) {
  const mode = shop?.tax_mode || TAX_MODE.INTERNAL;
  if (mode === TAX_MODE.QUICKBOOKS) {
    return createQuickBooksTaxProvider(opts);
  }
  return createInternalTaxProvider();
}
