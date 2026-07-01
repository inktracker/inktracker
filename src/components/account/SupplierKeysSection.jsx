import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";

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
  const [acEmailFromServer, setAcEmailFromServer] = useState("");
  const [ssAccount, setSsAccount] = useState("");
  const [ssKey, setSsKey] = useState("");
  const [acSubKey, setAcSubKey] = useState("");
  const [acEmail, setAcEmail] = useState("");
  const [acPassword, setAcPassword] = useState("");
  const [ssEditing, setSsEditing] = useState(true);
  const [acEditing, setAcEditing] = useState(true);
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
        setAcEmailFromServer(data.ac_email || "");
        setSsEditing(!data.ss);
        setAcEditing(!data.ac);
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
        if (acSubKey.trim()) supplierSecrets.ac_subscription_key = acSubKey.trim();
        if (email) supplierSecrets.ac_email = email;
        if (acPassword.trim() && acPassword !== "********") {
          supplierSecrets.ac_password = acPassword.trim();
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
            <p className="text-[10px] text-slate-500">Contact api@ascolour.com to get your API credentials.</p>
          </>
        ) : acHasKey ? (
          <div className="text-xs text-slate-500 space-y-1">
            <div>Credentials saved. Click <span className="font-semibold">Edit</span> to replace.</div>
            {acEmailFromServer && <div>Email: {acEmailFromServer}</div>}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No AS Colour credentials configured. Enter your account details to connect.</p>
        )}

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

      {/* SanMar — not currently supported */}
      <div className="border border-slate-200 bg-slate-50/50 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-500">SanMar</span>
            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">Not available</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          SanMar's API requires per-shop integration approval and static-IP whitelisting that doesn't fit our current infrastructure. Add SanMar items by hand for now — we may revisit a partner-route integration in a future release.
        </p>
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
