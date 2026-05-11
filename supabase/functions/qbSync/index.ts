// QuickBooks sync — handles all QB API operations from the InkTracker frontend.
// Actions: checkConnection | createInvoice | syncExpense | getCustomers

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { requireActiveSubscription } from "../_shared/subscriptionGuard.ts";
import {
  decideTokenRefresh,
  buildRefreshedTokenFields,
  extractConnectionStatus,
} from "../_shared/connectionLogic.js";
import {
  nextAvailableDocNumber as sharedNextAvailableDocNumber,
  buildQBDisplayName,
  buildQBCustomerBody as sharedBuildQBCustomerBody,
  escapeQbStringLiteral,
  buildInvoiceLinesFromPayload as sharedBuildInvoiceLinesFromPayload,
  extractPaymentLink as sharedExtractPaymentLink,
} from "../_shared/qbInvoice.js";

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_TOKEN_URL     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_BASE          = "https://quickbooks.api.intuit.com/v3/company";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Token management ────────────────────────────────────────────────────────

async function refreshToken(refreshTok: string) {
  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshTok }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[qbSync] Token refresh failed: ${res.status} ${body}`);
    if (body.includes("invalid_grant")) {
      throw new Error("Your QuickBooks connection has expired. Please go to Account → QuickBooks and reconnect.");
    }
    throw new Error("QuickBooks connection error. Please reconnect in Account settings.");
  }
  return res.json();
}

async function findUserProfile(supabase: any, authId: string, email: string | null) {
  // Use service role to read profile_secrets (RLS blocks user client)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let profile = await loadProfileWithSecrets(admin, { auth_id: authId });
  if (profile) return profile;

  // Fallback: match by email (profile may pre-date the auth user; auth_id still NULL)
  if (email) {
    const byEmail = await loadProfileWithSecrets(admin, { email });
    if (byEmail) {
      // Backfill auth_id so future lookups are fast
      if (!byEmail.auth_id) {
        await supabase.from("profiles").update({ auth_id: authId }).eq("id", byEmail.id);
        byEmail.auth_id = authId;
      }
      return byEmail;
    }
  }

  return null;
}

async function getValidTokens(supabase: any, authId: string, email: string | null) {
  const profile = await findUserProfile(supabase, authId, email);

  if (!profile?.qb_access_token) {
    throw new Error("QuickBooks not connected. Please connect your account in Settings.");
  }

  // Pure refresh-decision lives in ../_shared/connectionLogic.js (tested).
  if (!decideTokenRefresh(profile.qb_token_expires_at)) {
    return { accessToken: profile.qb_access_token, realmId: profile.qb_realm_id };
  }

  const fresh = await refreshToken(profile.qb_refresh_token);
  const refreshedFields = buildRefreshedTokenFields(fresh, profile.qb_refresh_token);

  // Write rotated tokens — use service role client for profile_secrets (RLS blocks user client)
  try {
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await updateProfileSecrets(adminClient, profile.id, refreshedFields, { dualWrite: true });
  } catch (err) {
    console.error("[qbSync] CRITICAL: failed to persist refreshed QB tokens:", err);
    throw new Error("Could not save refreshed QuickBooks tokens. Please try again.");
  }

  return { accessToken: fresh.access_token, realmId: profile.qb_realm_id };
}

// ── QB API helpers ──────────────────────────────────────────────────────────

function qbHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
}

async function qbQuery(token: string, realmId: string, query: string) {
  const url = `${QB_BASE}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, { headers: qbHeaders(token) });
  if (!res.ok) throw new Error(`QB query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function qbCreate(token: string, realmId: string, entity: string, body: object) {
  const url = `${QB_BASE}/${realmId}/${entity}?minorversion=65`;
  const res = await fetch(url, { method: "POST", headers: qbHeaders(token), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`QB create ${entity} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// Pick the next free DocNumber for a quote. If `base` is unused, returns base.
// Otherwise tries base-r2, base-r3, ... up to base-r99. Falls back to a
// timestamp suffix if (somehow) all 99 revisions are taken.
// Pure logic + tests live in ../_shared/qbInvoice.js + __tests__.
const nextAvailableDocNumber = sharedNextAvailableDocNumber;

async function qbUpdate(token: string, realmId: string, entity: string, body: object) {
  const url = `${QB_BASE}/${realmId}/${entity}?minorversion=65`;
  const res = await fetch(url, { method: "POST", headers: qbHeaders(token), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`QB update ${entity} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// ── Find or create QB Customer ──────────────────────────────────────────────

// Pure logic + tests live in ../_shared/qbInvoice.js + __tests__.
const buildQBCustomerBody = sharedBuildQBCustomerBody;

async function updateQBCustomer(token: string, realmId: string, qbId: string, customer: any) {
  const displayName = buildQBDisplayName(customer);

  // Fetch current SyncToken (required for QB updates)
  const existing = await qbQuery(token, realmId, `SELECT Id, SyncToken FROM Customer WHERE Id = '${qbId}'`);
  const current = existing?.QueryResponse?.Customer?.[0];
  if (!current) return qbId;

  const body = buildQBCustomerBody(customer, displayName);
  body.Id = qbId;
  body.SyncToken = current.SyncToken;
  body.sparse = true;

  await qbUpdate(token, realmId, "customer", body);
  return qbId;
}

async function findOrCreateCustomer(token: string, realmId: string, customer: any, supabase: any) {
  if (!customer) throw new Error("No customer data provided");
  // If already linked, push non-empty fields back to QB (sparse update — never wipes QB data)
  if (customer.qb_customer_id) {
    try {
      await updateQBCustomer(token, realmId, customer.qb_customer_id, customer);
    } catch (err) {
      console.warn("[QB] customer update failed (non-blocking):", err?.message);
    }
    return customer.qb_customer_id;
  }

  const displayName = buildQBDisplayName(customer);

  // Search QB for existing customer by email or name
  let qbCustomerId: string | null = null;

  if (customer.email) {
    try {
      const res = await qbQuery(token, realmId,
        `SELECT Id FROM Customer WHERE PrimaryEmailAddr = '${escapeQbStringLiteral(customer.email)}'`
      );
      const rows = res?.QueryResponse?.Customer ?? [];
      if (rows.length > 0) qbCustomerId = rows[0].Id;
    } catch {}
  }

  if (!qbCustomerId) {
    try {
      const safeName = escapeQbStringLiteral(displayName);
      const res = await qbQuery(token, realmId,
        `SELECT Id FROM Customer WHERE DisplayName = '${safeName}'`
      );
      const rows = res?.QueryResponse?.Customer ?? [];
      if (rows.length > 0) qbCustomerId = rows[0].Id;
    } catch {}
  }

  // Create customer if not found
  if (!qbCustomerId) {
    const newCustomer = buildQBCustomerBody(customer, displayName);
    const created = await qbCreate(token, realmId, "customer", newCustomer);
    qbCustomerId = created?.Customer?.Id;
  }

  // Save QB customer ID back to InkTracker
  if (qbCustomerId && customer.id) {
    await supabase.from("customers").update({ qb_customer_id: qbCustomerId }).eq("id", customer.id);
  }

  return qbCustomerId;
}

// ── Find or create a generic QB Service Item ────────────────────────────────

const DEFAULT_ITEM_NAME = "Custom Apparel";

async function findIncomeAccountId(token: string, realmId: string) {
  // Prefer "Sales" / "Services" / generic income; fall back to the first Income account.
  const preferred = ["Sales of Product Income", "Services", "Sales", "Income"];
  try {
    const res = await qbQuery(token, realmId,
      "SELECT Id, Name, AccountType FROM Account WHERE AccountType = 'Income' MAXRESULTS 100"
    );
    const accts: any[] = res?.QueryResponse?.Account ?? [];
    for (const name of preferred) {
      const hit = accts.find((a) => a.Name === name);
      if (hit) return hit.Id;
    }
    if (accts.length > 0) return accts[0].Id;
  } catch {}

  // Create a fallback Income account if none exists
  const created = await qbCreate(token, realmId, "account", {
    Name: "InkTracker Sales",
    AccountType: "Income",
    AccountSubType: "SalesOfProductIncome",
  });
  return created?.Account?.Id ?? null;
}

// Find-or-create a QB Service item by exact name, returning its Id.
// Caches the income account lookup across calls in the same request via a closure arg.
async function findOrCreateServiceItem(
  token: string,
  realmId: string,
  itemName: string,
  incomeAccountId: string,
) {
  const safe = escapeQbStringLiteral(itemName);
  const res = await qbQuery(token, realmId,
    `SELECT Id, Name FROM Item WHERE Name = '${safe}'`
  );
  const existing = res?.QueryResponse?.Item?.[0];
  if (existing) return existing.Id;

  const created = await qbCreate(token, realmId, "item", {
    Name: itemName,
    Type: "Service",
    IncomeAccountRef: { value: incomeAccountId },
  });
  return created?.Item?.Id ?? null;
}

// Resolve every unique item name referenced in a payload to its QB Item Id.
async function resolveItemIdMap(
  token: string,
  realmId: string,
  invoicePayload: any,
): Promise<Map<string, string>> {
  const names = new Set<string>();
  for (const line of invoicePayload?.lines ?? []) {
    names.add((line.itemName || DEFAULT_ITEM_NAME).trim());
  }
  names.add(DEFAULT_ITEM_NAME);

  const incomeAccountId = await findIncomeAccountId(token, realmId);
  if (!incomeAccountId) throw new Error("No QB Income account found; cannot create service items");

  const map = new Map<string, string>();
  for (const name of names) {
    const id = await findOrCreateServiceItem(token, realmId, name, incomeAccountId);
    if (id) map.set(name, id);
  }
  return map;
}

// ── Build QB invoice lines from InkTracker quote ────────────────────────────

// Build QB invoice lines from a pre-computed payload (built on the frontend
// using the same pricing helpers the UI uses, so totals match the quote).
// Each line may carry an `itemName` (e.g. "Embroidery", "Screen Printing") which
// is resolved to the matching QB Item Id via itemIdMap. Lines with no mapping
// fall back to the default item.
// Pure logic + tests live in ../_shared/qbInvoice.js + __tests__.
const buildInvoiceLinesFromPayload = sharedBuildInvoiceLinesFromPayload;
const extractPaymentLink = (invoiceData: any, _realmId?: string) => sharedExtractPaymentLink(invoiceData);

// ── Action: createInvoice ───────────────────────────────────────────────────

async function handleCreateInvoice(token: string, realmId: string, params: any, supabase: any) {
  const { quote, customer, invoicePayload } = params;

  if (!invoicePayload?.lines?.length) {
    throw new Error("Missing invoicePayload — frontend must compute quote totals");
  }

  // 1. Find or create customer in QB
  const qbCustomerId = await findOrCreateCustomer(token, realmId, customer, supabase);
  if (!qbCustomerId) throw new Error("Could not find or create QuickBooks customer");

  // 2. Resolve every QB item referenced by the payload (one per technique)
  const itemIdMap = await resolveItemIdMap(token, realmId, invoicePayload);

  // 3. Check QB customer's tax status
  let isTaxExempt = !!customer?.tax_exempt;
  try {
    const qbCustData = await qbQuery(token, realmId, `SELECT * FROM Customer WHERE Id = '${qbCustomerId}'`);
    const qbCust = qbCustData?.QueryResponse?.Customer?.[0];
    if (qbCust?.Taxable === false) isTaxExempt = true;
    console.error(`[createInvoice] QB customer ${qbCustomerId} Taxable=${qbCust?.Taxable}, isTaxExempt=${isTaxExempt}`);
  } catch (e) {
    console.error("[createInvoice] QB customer tax check failed (non-fatal):", e);
  }

  // 4. Build invoice lines from the precomputed payload (matches UI totals)
  const lines = buildInvoiceLinesFromPayload(invoicePayload, itemIdMap, DEFAULT_ITEM_NAME, isTaxExempt);
  if (lines.length === 0) throw new Error("Invoice payload has no valid lines");

  // 5. Create the invoice
  const billEmail = quote.customer_email || customer?.email;
  const billAddress = customer?.address;

  const baseDocNumber = String(quote.quote_id || "");

  // Tax handling: let QB auto-calculate tax using its own tax codes/rates.
  const taxPercent = parseFloat(invoicePayload?.taxPercent) || 0;
  const taxCode = (isTaxExempt || taxPercent === 0) ? "NON" : "TAX";

  lines.forEach((l: any) => {
    if (l.SalesItemLineDetail) {
      l.SalesItemLineDetail.TaxCodeRef = { value: taxCode };
    }
  });

  console.error(`[createInvoice] Tax: rate=${taxPercent}%, taxCode=${taxCode}, isTaxExempt=${isTaxExempt}`);

  let created: any;
  let qbInvoiceId: string = quote.qb_invoice_id || "";
  let qbInvoiceFinal: any;

  // If the quote already has a QB invoice ID, UPDATE the existing invoice
  // instead of creating a duplicate. This is the "resync" path.
  if (qbInvoiceId) {
    console.error(`[createInvoice] Updating existing QB invoice ${qbInvoiceId}`);
    try {
      // Fetch existing invoice to get its SyncToken (required for QB updates)
      const existing = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${qbInvoiceId}'`);
      const existingInv = existing?.QueryResponse?.Invoice?.[0];
      if (!existingInv) throw new Error(`QB invoice ${qbInvoiceId} not found — will create new`);

      const updateBody: any = {
        Id: qbInvoiceId,
        SyncToken: existingInv.SyncToken,
        sparse: true,
        CustomerRef: { value: qbCustomerId },
        AllowOnlineCreditCardPayment: true,
        AllowOnlineACHPayment: true,
        Line: lines,
        CustomerMemo: { value: quote.notes || "" },
        PrivateNote: `InkTracker Quote ${baseDocNumber} — updated ${new Date().toISOString().slice(0, 10)}`,
      };
      if (billEmail) {
        updateBody.BillEmail = { Address: billEmail };
      }
      if (billAddress) {
        updateBody.BillAddr = { Line1: billAddress };
        updateBody.ShipAddr = { Line1: billAddress };
      }

      const updated = await qbUpdate(token, realmId, "invoice", updateBody);
      created = updated;
      qbInvoiceFinal = updated?.Invoice ?? updated;
      qbInvoiceId = String(qbInvoiceFinal?.Id || qbInvoiceId);
    } catch (updateErr: any) {
      console.error(`[createInvoice] Update failed, creating new invoice:`, updateErr?.message);
      // Fall through to create path below
      qbInvoiceId = "";
    }
  }

  // Create new invoice if we don't have one yet (first sync or update failed)
  if (!qbInvoiceId) {
    const escapedBase = escapeQbStringLiteral(baseDocNumber);
    let existingDocs: string[] = [];
    try {
      const existingResp = await qbQuery(
        token,
        realmId,
        `SELECT DocNumber FROM Invoice WHERE DocNumber = '${escapedBase}' OR DocNumber LIKE '${escapedBase}-r%'`,
      );
      existingDocs = (existingResp?.QueryResponse?.Invoice || [])
        .map((i: any) => String(i.DocNumber || ""))
        .filter(Boolean);
    } catch (e) {
      console.error("[createInvoice] DocNumber lookup failed (will try base only):", e);
    }
    const docNumber = nextAvailableDocNumber(baseDocNumber, existingDocs);
    const isRevision = docNumber !== baseDocNumber;

    const invoiceBody: any = {
      CustomerRef: { value: qbCustomerId },
      DocNumber: docNumber,
      TxnDate: quote.date,
      DueDate: quote.due_date || undefined,
      AllowOnlineCreditCardPayment: true,
      AllowOnlineACHPayment: true,
      Line: lines,
      CustomerMemo: { value: quote.notes || "" },
      PrivateNote: isRevision
        ? `InkTracker Quote ${baseDocNumber} — revision (${docNumber})`
        : `InkTracker Quote ${baseDocNumber}`,
    };

    if (billEmail) {
      invoiceBody.BillEmail = { Address: billEmail };
      invoiceBody.EmailStatus = "NeedToSend";
    }
    if (billAddress) {
      invoiceBody.BillAddr = { Line1: billAddress };
      invoiceBody.ShipAddr = { Line1: billAddress };
    }

    let attempt = 0;
    let activeBody = invoiceBody;
    while (attempt < 5) {
      try {
        created = await qbCreate(token, realmId, "invoice", activeBody);
        qbInvoiceId = created?.Invoice?.Id;
        if (!qbInvoiceId) throw new Error("QB did not return an invoice ID");
        qbInvoiceFinal = created?.Invoice ?? created;
        break;
      } catch (createErr: any) {
        const isDuplicate = createErr?.message?.includes("Duplicate Document Number");
        if (!isDuplicate) throw createErr;

        existingDocs.push(activeBody.DocNumber);
        const nextDoc = nextAvailableDocNumber(baseDocNumber, existingDocs);
        console.error(
          `[createInvoice] DocNumber ${activeBody.DocNumber} taken — retrying as ${nextDoc}`
        );
        activeBody = {
          ...activeBody,
          DocNumber: nextDoc,
          PrivateNote: `InkTracker Quote ${baseDocNumber} — revision (${nextDoc})`,
        };
        attempt++;
      }
    }
    if (!qbInvoiceId) {
      throw new Error(
        `Could not create QB invoice for ${baseDocNumber} after retries. ` +
        `Existing revisions: ${existingDocs.join(", ")}`
      );
    }
  }

  // Re-read the invoice to ensure we have the final AST-computed tax/total
  try {
    const re = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${qbInvoiceId}'`);
    const fetched = re?.QueryResponse?.Invoice?.[0];
    if (fetched) qbInvoiceFinal = fetched;
  } catch (e) {
    console.error("[createInvoice] refetch failed (non-fatal):", e);
  }

  const qbTotal     = Number(qbInvoiceFinal?.TotalAmt ?? 0);
  const qbTaxAmount = Number(qbInvoiceFinal?.TxnTaxDetail?.TotalTax ?? 0);
  const qbSubtotal  = Number((qbTotal - qbTaxAmount).toFixed(2));

  const paymentLink = extractPaymentLink(qbInvoiceFinal || created, realmId);

  // 4b. If the quote's deposit was already paid, record the payment against this invoice
  const depositAmount = Number(invoicePayload?.depositAmount) || 0;
  if (quote.deposit_paid && depositAmount > 0) {
    try {
      await qbCreate(token, realmId, "payment", {
        CustomerRef: { value: qbCustomerId },
        TotalAmt: depositAmount,
        PrivateNote: `InkTracker deposit for quote ${quote.quote_id}`,
        Line: [{
          Amount: depositAmount,
          LinkedTxn: [{ TxnId: qbInvoiceId, TxnType: "Invoice" }],
        }],
      });
    } catch (err) {
      console.error("[createInvoice] deposit payment record failed:", err);
      // Don't fail the whole sync — invoice is still created
    }
  }

  // 5. Save QB invoice ID + payment link + final QB-computed totals back to the source record
  if (quote.id) {
    // Try quotes table first (quote-originated invoices)
    await supabase.from("quotes").update({
      qb_invoice_id:   qbInvoiceId,
      qb_payment_link: paymentLink,
      qb_synced_at:    new Date().toISOString(),
      qb_subtotal:     qbSubtotal,
      qb_tax_amount:   qbTaxAmount,
      qb_total:        qbTotal,
      status:          quote.status === "Draft" ? "Sent" : quote.status,
    }).eq("id", quote.id);

    // Also try invoices table (invoice-originated, same ID format)
    await supabase.from("invoices").update({
      qb_invoice_id:   qbInvoiceId,
      qb_payment_link: paymentLink,
    }).eq("id", quote.id);
  }

  // The DocNumber that was actually written to QB. Differs from quote.quote_id
  // when a previous invoice with the same base existed and we created a
  // versioned revision (e.g. Q-2026-115-r2).
  const qbDocNumber = String(qbInvoiceFinal?.DocNumber || baseDocNumber);

  return {
    qbInvoiceId,
    qbDocNumber,
    isRevision: qbDocNumber !== baseDocNumber,
    paymentLink,
    qbSubtotal,
    qbTaxAmount,
    qbTotal,
    customerRef: qbCustomerId,
  };
}

// ── Action: pullCustomers (QB → InkTracker) ────────────────────────────────

async function handlePullCustomers(token: string, realmId: string, supabase: any, shopOwner: string) {
  // Paginated fetch of all QB customers
  const pageSize = 1000;
  const all: any[] = [];
  let start = 1;
  while (true) {
    const res = await qbQuery(token, realmId,
      `SELECT * FROM Customer STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const batch: any[] = res?.QueryResponse?.Customer ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > 10000) break;
  }

  if (all.length === 0) return { imported: 0, skipped: 0, updated: 0, total: 0 };

  // Fetch existing InkTracker customers for this shop
  const { data: existing } = await supabase
    .from("customers")
    .select("id, qb_customer_id, email, name")
    .eq("shop_owner", shopOwner);
  const byQbId = new Map<string, any>();
  const byEmail = new Map<string, any>();
  for (const c of existing ?? []) {
    if (c.qb_customer_id) byQbId.set(String(c.qb_customer_id), c);
    if (c.email) byEmail.set(c.email.toLowerCase(), c);
  }

  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const qbCust of all) {
    if (qbCust.Active === false) { skipped++; continue; }

    const qbId = String(qbCust.Id);
    const email = qbCust.PrimaryEmailAddr?.Address ?? "";
    const phone = qbCust.PrimaryPhone?.FreeFormNumber ?? "";
    const addr = qbCust.BillAddr;
    const addressParts = [addr?.Line1, addr?.City, addr?.CountrySubDivisionCode, addr?.PostalCode].filter(Boolean);
    const name = [qbCust.GivenName, qbCust.FamilyName].filter(Boolean).join(" ") || qbCust.DisplayName || "";
    const company = qbCust.CompanyName || "";
    const notes = qbCust.Notes || "";
    const taxExempt = qbCust.Taxable === false;
    const taxId = qbCust.ResaleNum || "";

    const payload: any = {
      shop_owner: shopOwner,
      name: name || company || qbCust.DisplayName || "Unknown",
      company,
      email: email || null,
      phone: phone || null,
      address: addressParts.join(", ") || null,
      notes: notes || null,
      tax_exempt: taxExempt,
      tax_id: taxId || null,
      qb_customer_id: qbId,
    };

    // Check if already imported (by qb_customer_id or email)
    const existingByQb = byQbId.get(qbId);
    const existingByMail = email ? byEmail.get(email.toLowerCase()) : null;
    const match = existingByQb || existingByMail;

    if (match) {
      // Update existing — overwrite with QB data when QB has values
      const updates: any = {};
      if (!match.qb_customer_id) updates.qb_customer_id = qbId;
      if (company) updates.company = company;
      if (email) updates.email = email;
      if (phone) updates.phone = phone;
      if (addressParts.length > 0) updates.address = payload.address;
      if (taxId) updates.tax_id = taxId;
      if (name) updates.name = name;
      if (notes) updates.notes = notes;
      updates.tax_exempt = taxExempt;
      if (Object.keys(updates).length > 0) {
        await supabase.from("customers").update(updates).eq("id", match.id);
        updated++;
      } else {
        skipped++;
      }
    } else {
      // Create new
      const { error } = await supabase.from("customers").insert(payload);
      if (error) {
        console.error("[pullCustomers] insert failed:", error.message, payload.name);
        skipped++;
      } else {
        imported++;
      }
    }
  }

  return { imported, skipped, updated, total: all.length };
}

// ── Action: pullInvoices (QB → InkTracker) ─────────────────────────────────

async function handlePullInvoices(token: string, realmId: string, supabase: any, shopOwner: string) {
  // Paginated fetch of all QB invoices
  const pageSize = 1000;
  const all: any[] = [];
  let start = 1;
  while (true) {
    const res = await qbQuery(token, realmId,
      `SELECT * FROM Invoice STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const batch: any[] = res?.QueryResponse?.Invoice ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > 10000) break;
  }

  if (all.length === 0) return { imported: 0, skipped: 0, updated: 0, total: 0 };

  // Build customer lookup: qb_customer_id → InkTracker customer
  const { data: customers } = await supabase
    .from("customers")
    .select("id, qb_customer_id, name")
    .eq("shop_owner", shopOwner);
  const custByQbId = new Map<string, any>();
  for (const c of customers ?? []) {
    if (c.qb_customer_id) custByQbId.set(String(c.qb_customer_id), c);
  }

  // Check existing invoices to deduplicate (by invoice_id)
  const { data: existingInvoices } = await supabase
    .from("invoices")
    .select("id, invoice_id")
    .eq("shop_owner", shopOwner);
  const existingMap = new Map((existingInvoices ?? []).map((i: any) => [i.invoice_id, i.id]));

  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const qbInv of all) {
    const docNumber = qbInv.DocNumber || `QB-${qbInv.Id}`;

    // Update if already exists, insert if new
    const existingId = existingMap.get(docNumber);

    const qbCustId = qbInv.CustomerRef?.value;
    const custMatch = qbCustId ? custByQbId.get(String(qbCustId)) : null;
    const customerName = qbInv.CustomerRef?.name || "Unknown";

    const totalAmt = Number(qbInv.TotalAmt ?? 0);
    const balance = Number(qbInv.Balance ?? 0);
    const isPaid = balance === 0 && totalAmt > 0;

    // Map QB line items
    const lineItems = (qbInv.Line ?? [])
      .filter((l: any) => l.DetailType === "SalesItemLineDetail")
      .map((l: any) => ({
        id: `qb-${l.Id || Math.random().toString(36).slice(2)}`,
        style: l.Description || l.SalesItemLineDetail?.ItemRef?.name || "Item",
        garmentCost: 0,
        sizes: {},
        imprints: [],
        qty: Number(l.SalesItemLineDetail?.Qty ?? 1),
        lineTotal: Number(l.Amount ?? 0),
      }));

    // Calculate subtotal (pre-tax)
    const taxTotal = Number(qbInv.TxnTaxDetail?.TotalTax ?? 0);
    const subtotal = totalAmt - taxTotal;

    // Find paid date from linked payments if paid
    let paidDate: string | null = null;
    if (isPaid && qbInv.MetaData?.LastUpdatedTime) {
      paidDate = qbInv.MetaData.LastUpdatedTime.split("T")[0];
    }

    const payload: any = {
      invoice_id: docNumber,
      qb_invoice_id: String(qbInv.Id),
      shop_owner: shopOwner,
      customer_id: custMatch?.id || null,
      customer_name: custMatch?.name || customerName,
      date: qbInv.TxnDate || null,
      due: qbInv.DueDate || null,
      subtotal,
      tax: taxTotal,
      total: totalAmt,
      paid: isPaid,
      paid_date: paidDate,
      status: isPaid ? "Completed" : "Pending",
      line_items: lineItems,
      notes: qbInv.CustomerMemo?.value || null,
      discount: 0,
      tax_rate: 0,
      rush_rate: 0,
      extras: {},
    };

    if (existingId) {
      const { error } = await supabase.from("invoices").update(payload).eq("id", existingId);
      if (error) { console.error("[pullInvoices] update failed:", error.message, docNumber); skipped++; }
      else { updated++; }
    } else {
      const { error } = await supabase.from("invoices").insert(payload);
      if (error) { console.error("[pullInvoices] insert failed:", error.message, docNumber); skipped++; }
      else { imported++; }
    }
  }

  return { imported, skipped, updated, total: all.length };
}

// ── Action: getCustomerStats (live from QB) ────────────────────────────────

async function handleGetCustomerStats(token: string, realmId: string) {
  const all: any[] = [];
  let start = 1;
  const pageSize = 1000;
  while (true) {
    const res = await qbQuery(token, realmId,
      `SELECT Id, CustomerRef, TotalAmt, Balance FROM Invoice STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const batch: any[] = res?.QueryResponse?.Invoice ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > 10000) break;
  }

  // Aggregate per customer: { qbCustomerId: { orders, collected } }
  const stats: Record<string, { orders: number; collected: number }> = {};
  for (const inv of all) {
    const custId = inv.CustomerRef?.value;
    if (!custId) continue;
    if (!stats[custId]) stats[custId] = { orders: 0, collected: 0 };
    stats[custId].orders++;
    const total = Number(inv.TotalAmt ?? 0);
    const balance = Number(inv.Balance ?? 0);
    stats[custId].collected += (total - balance);
  }

  return { stats };
}

// ── Action: checkConnection ─────────────────────────────────────────────────

async function handleCheckConnection(supabase: any, authId: string, email: string | null) {
  const profile = await findUserProfile(supabase, authId, email);
  return extractConnectionStatus(profile);
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, accessToken, ...params } = body;

    if (!accessToken) {
      return Response.json({ error: "accessToken required" }, { status: 401, headers: CORS });
    }

    // Build Supabase client scoped to this user (respects RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    // Identify the authenticated user — profiles.auth_id is the only reliable filter
    const { data: { user }, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !user) {
      return Response.json({ error: "Invalid access token" }, { status: 401, headers: CORS });
    }

    if (action === "checkConnection") {
      const result = await handleCheckConnection(supabase, user.id, user.email ?? null);
      return Response.json(result, { headers: CORS });
    }

    // Subscription check — QB write operations cost money
    {
      const { data: subProfile } = await supabase.from("profiles").select("subscription_tier, subscription_status, trial_ends_at").eq("auth_id", user.id).maybeSingle();
      const blocked = requireActiveSubscription(subProfile);
      if (blocked) return blocked;
    }

    // All other actions need valid QB tokens
    const { accessToken: qbToken, realmId } = await getValidTokens(supabase, user.id, user.email ?? null);

    let result: any;
    switch (action) {
      case "createInvoice":
        result = await handleCreateInvoice(qbToken, realmId, params, supabase);
        break;
      case "syncCustomer": {
        const { customer } = params;
        if (!customer) throw new Error("Missing customer payload");
        const qbCustomerId = await findOrCreateCustomer(qbToken, realmId, customer, supabase);
        result = { qbCustomerId };
        break;
      }
      case "pullCustomers":
        result = await handlePullCustomers(qbToken, realmId, supabase, user.email ?? "");
        break;
      case "pullInvoices":
        result = await handlePullInvoices(qbToken, realmId, supabase, user.email ?? "");
        break;
      case "getCustomerStats":
        result = await handleGetCustomerStats(qbToken, realmId);
        break;
      case "getInvoicePDF": {
        const invId = params.qbInvoiceId;
        if (!invId) throw new Error("qbInvoiceId required");
        const pdfRes = await fetch(
          `${QB_BASE}/${realmId}/invoice/${invId}/pdf?minorversion=65`,
          { headers: { ...qbHeaders(qbToken), Accept: "application/pdf" } }
        );
        if (!pdfRes.ok) throw new Error(`QB PDF fetch failed: ${pdfRes.status}`);
        const pdfBuffer = await pdfRes.arrayBuffer();
        // Chunked base64 conversion to avoid max argument overflow on large PDFs
        const bytes = new Uint8Array(pdfBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const base64 = btoa(binary);
        result = { pdf: base64, filename: `Invoice-${invId}.pdf` };
        break;
      }
      case "deactivateCustomer": {
        const custId = params.customerId;
        if (!custId) throw new Error("customerId required");
        const custRes = await qbQuery(qbToken, realmId, `SELECT * FROM Customer WHERE Id = '${custId}'`);
        const cust = custRes?.QueryResponse?.Customer?.[0];
        if (cust) {
          await qbUpdate(qbToken, realmId, "customer", {
            Id: cust.Id,
            SyncToken: cust.SyncToken,
            Active: false,
            DisplayName: cust.DisplayName,
            sparse: true,
          });
          result = { deactivated: true, customerId: custId };
        } else {
          result = { deactivated: false, reason: "Customer not found in QB" };
        }
        break;
      }
      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400, headers: CORS });
    }

    return Response.json({ success: true, ...result }, { headers: CORS });
  } catch (err) {
    console.error("qbSync error:", err);
    return Response.json({ error: err.message }, { status: 500, headers: CORS });
  }
});
