import { Upload, X } from "lucide-react";
import { DEFAULT_BRAND, BRAND_PRESETS } from "@/lib/branding";
import { SHOP_TIMEZONE_OPTIONS } from "@/lib/shopTimezone";
import PressesSection from "./PressesSection";

// Account → Shop Information section (presentational). Extracted verbatim
// from Account.jsx as a pure decomposition — no behavior change. The form
// state, save/upload handlers, and the load-on-mount effect stay owned by
// the parent Account page (they initialize on page load, not when this
// collapsible section is expanded); everything the JSX needs is a prop.
export default function ProfileSection({
  user,
  firstName, setFirstName,
  lastName, setLastName,
  shopName, setShopName,
  phone, setPhone,
  taxRate, setTaxRate,
  timezone, setTimezone,
  address, setAddress,
  city, setCity,
  stateVal, setStateVal,
  zip, setZip,
  website, setWebsite,
  logoUrl,
  brandColor, setBrandColor,
  uploading,
  saving,
  message,
  handleSave,
  handleLogoUpload,
  handleRemoveLogo,
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">First Name</label>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Joe"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Last Name</label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Smith"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Shop Name
        </label>
        <input
          type="text"
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Phone</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Default Tax Rate %</label>
          <input type="number" step="0.001" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="8.265"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <p className="text-xs text-slate-500 mt-1">Enter the percentage (8.265 means 8.265%), not a decimal.</p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Shop Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
          >
            {SHOP_TIMEZONE_OPTIONS.map((opt) => (
              <option key={opt.value || "__default__"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1">Used by the calendar to know what "today" means for your shop. Lets employees logging in from another state still see the right "today."</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Address</label>
        <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St"
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-3">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">City</label>
          <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Reno"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">State</label>
          <input type="text" value={stateVal} onChange={e => setStateVal(e.target.value)} placeholder="NV" maxLength={2}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500 uppercase" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">ZIP</label>
          <input type="text" value={zip} onChange={e => setZip(e.target.value)} placeholder="89502"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Website</label>
        <input type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourshop.com"
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <p className="text-xs text-slate-500 mt-1">Shown on art proofs in place of the platform footer.</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Logo
        </label>

        {logoUrl && (
          <div className="mb-3 relative w-24 h-24">
            <img
              src={logoUrl}
              alt="Logo"
              className="w-24 h-24 object-contain rounded-lg border border-slate-200 dark:border-slate-700"
            />
            <button
              onClick={handleRemoveLogo}
              className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <label className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-teal-400 cursor-pointer transition bg-slate-50 dark:bg-slate-800 hover:bg-teal-50">
          <Upload className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-600">
            {uploading ? "Uploading..." : logoUrl ? "Change Logo" : "Upload Logo"}
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Brand Color
        </label>
        <p className="text-xs text-slate-500 mb-3">
          Drives the order wizard's primary button and step accents. Leave unset to use the InkTracker default.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {BRAND_PRESETS.map(p => {
            const selected = (brandColor || "").toLowerCase() === p.hex;
            return (
              <button
                key={p.hex}
                type="button"
                onClick={() => setBrandColor(p.hex)}
                title={p.label}
                aria-label={p.label}
                aria-pressed={selected}
                className={`w-9 h-9 rounded-full border-2 transition ${selected ? "border-slate-900 dark:border-white scale-110" : "border-slate-200 dark:border-slate-700"}`}
                style={{ backgroundColor: p.hex }}
              />
            );
          })}
          {brandColor && (
            <button
              type="button"
              onClick={() => setBrandColor("")}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 ml-1 underline"
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={brandColor || DEFAULT_BRAND}
            onChange={e => setBrandColor(e.target.value)}
            className="w-12 h-10 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent"
            aria-label="Custom brand color"
          />
          <div
            className="px-4 py-2 rounded-lg text-white text-sm font-semibold"
            style={{ backgroundColor: brandColor || DEFAULT_BRAND }}
          >
            Preview button
          </div>
          <span className="text-xs font-mono text-slate-500">
            {brandColor ? brandColor.toLowerCase() : `${DEFAULT_BRAND} (default)`}
          </span>
        </div>
      </div>

      {message && (
        <div
          className={`text-sm font-semibold py-2 px-3 rounded-lg ${
            message.includes("Error")
              ? "bg-red-50 text-red-600"
              : "bg-emerald-50 text-emerald-600"
          }`}
        >
          {message}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || uploading}
        className="bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2.5 rounded-xl transition"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>

      <div className="border-t border-slate-200 dark:border-slate-700 pt-5 mt-2">
        <div className="text-sm font-semibold text-slate-700 mb-2">Presses</div>
        <PressesSection user={user} />
      </div>
    </div>
  );
}
