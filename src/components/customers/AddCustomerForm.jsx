import { normalizeShipTo } from "@/lib/tax/address";
import AddressFields from "@/components/shared/AddressFields";
import ExemptionFields from "@/components/customers/ExemptionFields";
import ReactivateLink from "@/components/shared/ReactivateLink";

// The "New Customer" inline form shown when Add Customer is toggled open.
// Pure move of the JSX out of Customers.jsx — parent still owns `form`
// state and the `handleAdd` submit path.
export default function AddCustomerForm({ form, setForm, handleAdd, addingCustomer, readOnly = false, reactivateHref }) {
  return (
    <div className="bg-teal-50 border border-teal-200 rounded-2xl p-5 space-y-3">
      <div className="text-xs font-bold text-teal-700 uppercase tracking-widest">
        New Customer
      </div>

      <div className="grid gap-3 grid-cols-2">
        {[
          { key: "name", label: "Name *", placeholder: "Jane Smith" },
          { key: "company", label: "Company / Org", placeholder: "Company name" },
          { key: "email", label: "Email", placeholder: "jane@example.com", type: "email" },
          { key: "phone", label: "Phone", placeholder: "(775) 555-0000", type: "tel" },
          { key: "notes", label: "Notes", placeholder: "Terms, preferences…" },
          { key: "tax_id", label: "Tax ID", placeholder: "12-3456789" },
        ].map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              {f.label}
            </label>
            <input
              type={f.type || "text"}
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-300"
            />
          </div>
        ))}
      </div>

      <AddressFields
        label="Billing Address"
        value={form.bill_to_address}
        onChange={(next) => setForm({ ...form, bill_to_address: next })}
      />

      <AddressFields
        label="Shipping Address"
        sublabel="used to calculate sales tax"
        taxHint
        value={form.ship_to_address}
        onChange={(next) => setForm({ ...form, ship_to_address: next })}
        onSameAsBilling={() => setForm({ ...form, ship_to_address: normalizeShipTo(form.bill_to_address) })}
      />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="tax_exempt_new"
          checked={form.tax_exempt}
          onChange={(e) => {
            const checked = e.target.checked;
            setForm({
              ...form,
              tax_exempt: checked,
              // Unchecking clears the cert so a stale certificate can't linger.
              ...(checked ? {} : {
                exemption_type: "", exemption_certificate_number: "",
                exemption_certificate_path: "", exemption_expires_at: "", exemption_states: null,
              }),
            });
          }}
          className="w-4 h-4 accent-teal-600"
        />
        <label htmlFor="tax_exempt_new" className="text-sm font-semibold text-slate-600">
          Tax Exempt
        </label>
      </div>

      {form.tax_exempt && (
        <ExemptionFields
          key="exempt-new"
          value={form}
          onChange={(patch) => setForm({ ...form, ...patch })}
        />
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-widest">Default Payment Terms</label>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="payment_terms_new"
              checked={Number(form.default_deposit_pct) === 0}
              onChange={() => setForm({ ...form, default_deposit_pct: 0 })}
              className="accent-teal-600"
            />
            Pay in full
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="payment_terms_new"
              checked={Number(form.default_deposit_pct) > 0}
              onChange={() => setForm({ ...form, default_deposit_pct: 50 })}
              className="accent-teal-600"
            />
            Deposit
          </label>
          {Number(form.default_deposit_pct) > 0 && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="100"
                value={form.default_deposit_pct}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setForm({ ...form, default_deposit_pct: Number.isFinite(v) ? Math.max(1, Math.min(100, v)) : 50 });
                }}
                className="w-14 text-xs text-center border border-slate-200 dark:border-slate-700 rounded px-1.5 py-1"
              />
              <span className="text-slate-500">%</span>
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-500 bg-white dark:bg-slate-900/70 border border-teal-100 rounded-xl px-3 py-2">
        Add the customer first. Then open Edit Customer to upload artwork files that persist after reload.
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleAdd}
          disabled={addingCustomer || !form.name.trim() || readOnly}
          title={readOnly ? "Your subscription has ended — reactivate to create and edit." : undefined}
          className="bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
        >
          {addingCustomer ? "Adding…" : "Add Customer"}
        </button>
        <ReactivateLink show={readOnly} href={reactivateHref} />
      </div>
    </div>
  );
}
