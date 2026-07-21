import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";
import { validateAcCredsSave, acConnectionWarning } from "@/lib/account/acCredsValidation";
import { shopScope } from "@/lib/shopScope";
import { loadShopPricingConfig } from "@/components/shared/pricing";
import { preferredSupplier } from "@/lib/suppliers/preference";

// Supplier API keys editor. Extracted verbatim from Account.jsx as a pure
// decomposition — no behavior change. Receives the current `user`.
export default function SupplierKeysSection({ user }) {
  // Supplier secrets (ss_*, ac_*) live on profile_secrets now — the
  // service-role-only RLS-locked table. The frontend can't read them
  // back directly; we fetch boolean flags + the non-secret ac_email
  // via the profileSecrets edge function instead. Once flags load,
  // the "Connected" badges + editing state derive from them.
  const [ssHasKey, setSsHasKey] = useState(false);
  const [acHasKey, setAcHasKey] = useState(false);
  const [smHasKey, setSmHasKey] = useState(false);
  const [acEmailFromServer, setAcEmailFromServer] = useState("");
  const [smUsernameFromServer, setSmUsernameFromServer] = useState("");
  const [acHasPassword, setAcHasPassword] = useState(false);
  const [ssAccount, setSsAccount] = useState("");
  const [ssKey, setSsKey] = useState("");
  const [acSubKey, setAcSubKey] = useState("");
  const [acEmail, setAcEmail] = useState("");
  const [acPassword, setAcPassword] = useState("");
  const [smCustomerNumber, setSmCustomerNumber] = useState("");
  const [smUsername, setSmUsername] = useState("");
  const [smPassword, setSmPassword] = useState("");
  const [ssEditing, setSsEditing] = useState(true);
  const [acEditing, setAcEditing] = useState(true);
  const [smEditing, setSmEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load connection flags on mount. Until they load, we render in "no
  // connection" mode so the user doesn't briefly see stale state.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const { data, error } = await base44.functions.invoke("profileSecrets", {
          action: "getFlags",
          accessToken: session.access_token,
        });
        if (!alive || error || !data) return;
        setSsHasKey(!!data.ss);
        setAcHasKey(!!data.ac);
        setSmHasKey(!!data.sanmar);
        setAcEmailFromServer(data.ac_email || "");
        setSmUsernameFromServer(data.sanmar_username || "");
        setAcHasPassword(!!data.ac_password);
        setSsEditing(!data.ss);
        setAcEditing(!data.ac);
        setSmEditing(!data.sanmar);
        if (data.ac_email) setAcEmail(data.ac_email);
      } catch {
        // Stay in "no connection" mode — the user can still re-enter creds.
      }
    })();
    return () => { alive = false; };
  }, []);

  // Free-freight thresholds — drives the progress bar on Purchase Orders.
  // Per supplier so each can have its own minimum (AS Colour vs S&S vs others).
  const initialThresholds = user?.free_freight_thresholds || {};
  const [acThreshold, setAcThreshold] = useState(initialThresholds["AS Colour"] ?? "");
  const [ssThreshold, setSsThreshold] = useState(initialThresholds["S&S Activewear"] ?? "");
  // Default AS Colour warehouse for auto-routing on the PO page. When
  // a SKU is in stock at this warehouse, items ship from here;
  // otherwise they auto-route to the other US warehouse.
  const [defaultAcWarehouse, setDefaultAcWarehouse] = useState(user?.default_ac_warehouse || "CA");
  // Default garment supplier (Joe 2026-07-20): which supplier's listing
  // auto-selects when a garment is carried by both S&S and SanMar.
  // Lives in shops.pricing_config.defaultSupplier so every pricing
  // surface (both quote editors, wizard enrichment) reads it for free.
  const [defaultSupplierPref, setDefaultSupplierPref] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
        if (alive) setDefaultSupplierPref(preferredSupplier(shops?.[0]?.pricing_config));
      } catch { /* stays "no preference" */ }
    })();
    return () => { alive = false; };
  }, [user]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      // Secret credentials (ss_*, ac_*) go through the profileSecrets edge
      // function — they live on the service-role-only profile_secrets table.
      // Non-secret prefs (thresholds, warehouse) still go through updateMe
      // which writes to profiles.
      //
      // Only send fields the user actually typed into. An empty input is
      // NOT a "clear" signal — that's a footgun (walking away from the
      // form would otherwise null saved keys). Use Disconnect to clear.
      const supplierSecrets = {};
      if (ssEditing) {
        const acct = ssAccount.trim();
        const key = ssKey.trim();
        // S&S account numbers are numeric only. Browsers will sometimes
        // autofill the user's email into the Account # input because it
        // sits next to a password field — without this guard that string
        // would silently overwrite a working set of credentials on save.
        if (acct && !/^\d+$/.test(acct)) {
          notify.error("S&S Account Number must be digits only. Saved credentials were not touched.");
          setSaving(false);
          return;
        }
        if (acct) supplierSecrets.ss_account_number = acct;
        if (key) supplierSecrets.ss_api_key = key;
      }
      if (acEditing) {
        const email = acEmail.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          notify.error("AS Colour email looks invalid. Saved credentials were not touched.");
          setSaving(false);
          return;
        }
        const typedPassword = acPassword.trim() && acPassword !== "********" ? acPassword.trim() : "";
        // Completeness gate: pricing needs email + password (Bearer token),
        // and saving a key stops the platform fallback — so a partial save
        // would silently strip prices from every AC lookup. Effective state
        // (typed + already-stored) must be all three or nothing.
        const validity = validateAcCredsSave(
          { key: acSubKey.trim(), email, password: typedPassword },
          { hasKey: acHasKey, hasEmail: !!acEmailFromServer, hasPassword: acHasPassword },
        );
        if (!validity.ok) {
          notify.error(validity.error);
          setSaving(false);
          return;
        }
        if (acSubKey.trim()) supplierSecrets.ac_subscription_key = acSubKey.trim();
        if (email) supplierSecrets.ac_email = email;
        if (typedPassword) supplierSecrets.ac_password = typedPassword;
      }
      if (smEditing) {
        const num = smCustomerNumber.trim();
        // SanMar customer numbers are numeric — same autofill guard as S&S.
        if (num && !/^\d+$/.test(num)) {
          notify.error("SanMar Customer Number must be digits only. Saved credentials were not touched.");
          setSaving(false);
          return;
        }
        if (num) supplierSecrets.sanmar_customer_number = num;
        if (smUsername.trim()) supplierSecrets.sanmar_username = smUsername.trim();
        if (smPassword.trim() && smPassword !== "********") {
          supplierSecrets.sanmar_password = smPassword.trim();
        }
      }

      const profileUpdates = {};
      const thresholds = { ...initialThresholds };
      const acT = Number(acThreshold);
      const ssT = Number(ssThreshold);
      if (acThreshold === "" || acT === 0) delete thresholds["AS Colour"];
      else if (acT > 0) thresholds["AS Colour"] = acT;
      if (ssThreshold === "" || ssT === 0) delete thresholds["S&S Activewear"];
      else if (ssT > 0) thresholds["S&S Activewear"] = ssT;
      profileUpdates.free_freight_thresholds = thresholds;
      profileUpdates.default_ac_warehouse = defaultAcWarehouse || "CA";

      if (Object.keys(supplierSecrets).length > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        const { error: invErr, data } = await base44.functions.invoke("profileSecrets", {
          action: "update",
          updates: supplierSecrets,
          accessToken: session?.access_token,
        });
        if (invErr) throw invErr;
        if (data?.error) throw new Error(data.error);
        // Refresh flags so badges update without a full page reload.
        if (supplierSecrets.ss_account_number || supplierSecrets.ss_api_key) {
          setSsHasKey(true);
          setSsEditing(false);
        }
        if (supplierSecrets.ac_subscription_key) {
          setAcHasKey(true);
          setAcEditing(false);
        }
        if (supplierSecrets.ac_email) setAcEmailFromServer(supplierSecrets.ac_email);
        if (supplierSecrets.sanmar_customer_number || supplierSecrets.sanmar_username || supplierSecrets.sanmar_password) {
          setSmHasKey(true);
          setSmEditing(false);
        }
        if (supplierSecrets.sanmar_username) setSmUsernameFromServer(supplierSecrets.sanmar_username);
        if (supplierSecrets.ac_password) setAcHasPassword(true);
      }

      // Default supplier → shops.pricing_config (see state comment).
      try {
        const shops = await base44.entities.Shop.filter({ owner_email: shopScope(user) });
        if (shops?.[0]) {
          const pc = { ...(shops[0].pricing_config || {}) };
          if (defaultSupplierPref) pc.defaultSupplier = defaultSupplierPref;
          else delete pc.defaultSupplier;
          await base44.entities.Shop.update(shops[0].id, { pricing_config: pc });
          // Refresh the engine's module-level config so the preference is
          // live in the quote editor without a reload (same pattern as
          // PricingConfigEditor's save).
          loadShopPricingConfig(pc, shopScope(user));
        }
      } catch (err) {
        console.error("[SupplierKeys] default supplier save failed:", err);
        throw err;
      }

      await base44.auth.updateMe(profileUpdates);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      notify.error("Couldn't save supplier credentials", err);
    } finally {
      setSaving(false);
    }
  }

  // Explicit disconnect — only way to actually null the credentials.
  // Save never wipes; users have to opt in here. Goes through the
  // profileSecrets edge function since the secrets live on the
  // service-role-only profile_secrets table.
  async function handleDisconnect(supplier) {
    const labels = {
      ss: "S&S Activewear",
      ac: "AS Colour",
      sanmar: "SanMar",
    };
    if (!confirm(`Disconnect ${labels[supplier]}? Your saved API credentials will be removed. You can re-enter them later.`)) {
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error: invErr, data } = await base44.functions.invoke("profileSecrets", {
        action: "disconnectProvider",
        provider: supplier,
        accessToken: session?.access_token,
      });
      if (invErr) throw invErr;
      if (data?.error) throw new Error(data.error);
      if (supplier === "ac") {
        setAcSubKey(""); setAcEmail(""); setAcPassword("");
        setAcHasKey(false); setAcEditing(true); setAcEmailFromServer("");
        setAcHasPassword(false);
      } else if (supplier === "sanmar") {
        setSmCustomerNumber(""); setSmUsername(""); setSmPassword("");
        setSmHasKey(false); setSmEditing(true); setSmUsernameFromServer("");
      } else {
        setSsAccount(""); setSsKey("");
        setSsHasKey(false); setSsEditing(true);
      }
    } catch (err) {
      notify.error("Disconnect failed", err);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300";

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500 leading-relaxed">
        Connect your own supplier accounts for wholesale pricing and ordering. Without your own keys, you can still browse catalogs and check inventory.
      </p>

      {/* S&S Activewear */}
      <div className={`border rounded-xl p-4 space-y-3 ${ssHasKey && !ssEditing ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-red-600">S&S Activewear</span>
            {ssHasKey && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Connected</span>}
          </div>
          {ssHasKey && !ssEditing && (
            <div className="flex items-center gap-3">
              <button onClick={() => { setSsEditing(true); setSsAccount(""); setSsKey(""); }}
                className="text-xs font-semibold text-teal-600 hover:text-teal-700">Edit</button>
              <button onClick={() => handleDisconnect("ss")}
                className="text-xs font-semibold text-slate-500 hover:text-red-500">Disconnect</button>
            </div>
          )}
        </div>
        {ssEditing ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Account Number</label>
                <input type="text" value={ssAccount} onChange={e => setSsAccount(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">API Key</label>
                <input type="password" value={ssKey} onChange={e => setSsKey(e.target.value)} className={inputCls} />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">Find these in your S&S Activewear account under API settings.</p>
          </>
        ) : ssHasKey ? (
          <div className="text-xs text-slate-500">
            Credentials saved. Click <span className="font-semibold">Edit</span> to replace.
          </div>
        ) : (
          <p className="text-xs text-slate-500">No S&S credentials configured. Enter your account details to connect.</p>
        )}
      </div>

      {/* AS Colour */}
      <div className={`border rounded-xl p-4 space-y-3 ${acHasKey && !acEditing ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-700">AS Colour</span>
            {acHasKey && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Connected</span>}
          </div>
          {acHasKey && !acEditing && (
            <div className="flex items-center gap-3">
              <button onClick={() => { setAcEditing(true); setAcSubKey(""); setAcEmail(""); setAcPassword(""); }}
                className="text-xs font-semibold text-teal-600 hover:text-teal-700">Edit</button>
              <button onClick={() => handleDisconnect("ac")}
                className="text-xs font-semibold text-slate-500 hover:text-red-500">Disconnect</button>
            </div>
          )}
        </div>
        {acEditing ? (
          <>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Subscription Key</label>
              <input type="text" value={acSubKey} onChange={e => setAcSubKey(e.target.value)} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                <input type="email" value={acEmail} onChange={e => setAcEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
                <input type="password" value={acPassword} onChange={e => setAcPassword(e.target.value)} className={inputCls} />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              Contact api@ascolour.com to get your API credentials. All three fields are required —
              pricing runs on your account login, not just the key. After connecting, re-sync your
              wizard styles (Account → Wizard Setup) so garment prices update.
            </p>
          </>
        ) : acHasKey ? (
          <div className="text-xs text-slate-500 space-y-1">
            <div>Credentials saved. Click <span className="font-semibold">Edit</span> to replace.</div>
            {acEmailFromServer && <div>Email: {acEmailFromServer}</div>}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No AS Colour credentials configured. Enter your account details to connect.</p>
        )}

        {(() => {
          // Shops connected before the completeness gate existed can be in
          // the key-only state — surface it instead of letting prices
          // silently come back empty.
          const warning = acConnectionWarning({ hasKey: acHasKey, hasEmail: !!acEmailFromServer, hasPassword: acHasPassword });
          return warning ? (
            <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
              <strong className="block mb-1 text-amber-900">Prices can&rsquo;t load yet</strong>
              {warning}
            </div>
          ) : null;
        })()}

        <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
          <strong className="block mb-1 text-amber-900">Want to place orders too?</strong>
          The API key above lets you browse the catalog and check live inventory immediately.
          To actually <strong>submit orders</strong> through InkTracker, AS Colour requires approved <strong>credit terms</strong> (their only API payment option).
          <br /><br />
          <strong>How to apply:</strong> email <a href="mailto:support@ascolour.com" className="font-mono underline">support@ascolour.com</a> requesting the credit application. They'll send a PDF; complete and return it. Approval takes <strong>2-4 weeks</strong> (they contact your credit references, then submit to their CFO — speeding up the references step yourself can help).
          <br /><br />
          Without credit terms, orders submit but land in <strong>"awaiting payment"</strong> in AS Colour's system until you arrange payment directly with them.
        </div>
      </div>

      {/* SanMar */}
      <div className={`border rounded-xl p-4 space-y-3 ${smHasKey && !smEditing ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-blue-700">SanMar</span>
            {smHasKey && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Connected</span>}
          </div>
          {smHasKey && !smEditing && (
            <div className="flex items-center gap-3">
              <button onClick={() => { setSmEditing(true); setSmCustomerNumber(""); setSmUsername(""); setSmPassword(""); }}
                className="text-xs font-semibold text-teal-600 hover:text-teal-700">Edit</button>
              <button onClick={() => handleDisconnect("sanmar")}
                className="text-xs font-semibold text-slate-500 hover:text-red-500">Disconnect</button>
            </div>
          )}
        </div>
        {smEditing ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Customer Number</label>
                <input type="text" value={smCustomerNumber} onChange={e => setSmCustomerNumber(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">SanMar.com Username</label>
                <input type="text" value={smUsername} onChange={e => setSmUsername(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">SanMar.com Password</label>
                <input type="password" value={smPassword} onChange={e => setSmPassword(e.target.value)} className={inputCls} />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              Your sanmar.com login works here once SanMar has enabled Web Services on your account.
            </p>
          </>
        ) : smHasKey ? (
          <div className="text-xs text-slate-500 space-y-1">
            <div>Credentials saved. Click <span className="font-semibold">Edit</span> to replace.</div>
            {smUsernameFromServer && <div>Username: {smUsernameFromServer}</div>}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No SanMar credentials configured. Enter your account details to connect.</p>
        )}

        <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 text-[11px] text-amber-800 leading-relaxed">
          <strong className="block mb-1 text-amber-900">One-time SanMar setup required first</strong>
          SanMar enables API access per account. Email <a href="mailto:sanmarintegrations@sanmar.com" className="font-mono underline">sanmarintegrations@sanmar.com</a> with
          your customer number, e-sign their free Integration Agreement, and access is granted in 1–2 business days.
          After that, your regular sanmar.com login above connects InkTracker to live SanMar style data and your contracted pricing.
          Style lookups use exact style numbers (PC61, K420, DT6000). Ordering through InkTracker requires SanMar's separate PO-integration approval — coming later.
        </div>
      </div>

      {/* Default garment supplier */}
      <div className="border border-slate-200 rounded-2xl p-4 space-y-2">
        <div className="text-sm font-bold text-slate-700">Default garment supplier</div>
        <p className="text-xs text-slate-500">
          Many brands (Gildan, Bella+Canvas, District…) are carried by both S&amp;S and SanMar.
          When a style exists at both, this supplier&apos;s listing is selected automatically —
          the brand dropdown still offers the other, so you can always switch per line.
        </p>
        <div className="flex gap-2 flex-wrap">
          {[
            { value: "", label: "No preference", sub: "S&S listed first (legacy order)" },
            { value: "S&S Activewear", label: "S&S Activewear", sub: "auto-select S&S when both carry it" },
            { value: "SanMar", label: "SanMar", sub: "auto-select SanMar when both carry it" },
          ].map((opt) => (
            <button
              key={opt.value || "none"}
              type="button"
              onClick={() => setDefaultSupplierPref(opt.value)}
              className={`text-left border-2 rounded-xl px-3 py-2 transition flex-1 min-w-[150px] ${
                defaultSupplierPref === opt.value ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className={`text-xs font-bold ${defaultSupplierPref === opt.value ? "text-teal-700" : "text-slate-700"}`}>{opt.label}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{opt.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Free-freight thresholds */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-slate-700">Free-freight thresholds</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Order subtotal at which each supplier ships free. Drives the progress bar
            on Purchase Orders so you can pair jobs to hit it.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">AS Colour ($)</label>
            <input type="number" min="0" step="1" value={acThreshold}
              onChange={e => setAcThreshold(e.target.value)}
              placeholder="e.g. 200"
              className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">S&S Activewear ($)</label>
            <input type="number" min="0" step="1" value={ssThreshold}
              onChange={e => setSsThreshold(e.target.value)}
              placeholder="e.g. 200"
              className={inputCls} />
          </div>
        </div>
      </div>

      {/* Default AS Colour warehouse */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-slate-700">Default AS Colour warehouse</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Items on a PO ship from here when in stock. If the SKU is out of stock at your default,
            it auto-routes to the other US warehouse silently — no per-PO decision needed.
          </p>
        </div>
        <div>
          <select
            value={defaultAcWarehouse}
            onChange={e => setDefaultAcWarehouse(e.target.value)}
            className={inputCls}
          >
            <option value="CA">CA — Carson (West Coast)</option>
            <option value="NC">NC — Charlotte (East Coast)</option>
          </select>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition disabled:opacity-50">
        {saving ? "Saving..." : saved ? "Saved" : "Save API Keys"}
      </button>
    </div>
  );
}
