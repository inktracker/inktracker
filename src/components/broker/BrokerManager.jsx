import { useEffect, useMemo, useState } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import ModalBackdrop from "../shared/ModalBackdrop";
import {
  Users,
  ChevronDown,
  ChevronUp,
  Search,
  Plus,
  CheckCircle2,
  AlertCircle,
  XCircle,
  FileText,
  Building2,
  Mail,
  Phone,
  MapPin,
  Save,
  Upload,
} from "lucide-react";

const DEFAULT_CREDENTIALS = [
  {
    type: "resale_certificate",
    title: "Resale Certificate",
    number: "",
    state: "",
    expiration: "",
    file: "",
    status: "missing",
    verified_at: "",
  },
  {
    type: "w9",
    title: "W-9",
    number: "",
    state: "",
    expiration: "",
    file: "",
    status: "missing",
    verified_at: "",
  },
  {
    type: "business_license",
    title: "Business License",
    number: "",
    state: "",
    expiration: "",
    file: "",
    status: "missing",
    verified_at: "",
  },
];

function normalizeCredentials(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_CREDENTIALS;
  return DEFAULT_CREDENTIALS.map((base) => {
    const match = raw.find((c) => c.type === base.type);
    return match ? { ...base, ...match } : base;
  });
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function getStatusPill(status) {
  if (status === "verified") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (status === "pending") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (status === "expired") {
    return "bg-red-50 text-red-700 border-red-200";
  }
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function getStatusIcon(status) {
  if (status === "verified") return <CheckCircle2 className="w-4 h-4" />;
  if (status === "pending") return <AlertCircle className="w-4 h-4" />;
  if (status === "expired") return <XCircle className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

function getBrokerHealth(broker) {
  const credentials = normalizeCredentials(broker.broker_credentials);
  const missing = credentials.filter((c) => c.status === "missing").length;
  const expired = credentials.filter((c) => c.status === "expired").length;
  const pending = credentials.filter((c) => c.status === "pending").length;
  const verified = credentials.filter((c) => c.status === "verified").length;

  if (missing > 0 || expired > 0) {
    return {
      label: missing > 0 ? `${missing} missing` : `${expired} expired`,
      classes: "bg-red-50 text-red-700 border-red-200",
    };
  }

  if (pending > 0) {
    return {
      label: `${pending} pending`,
      classes: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }

  return {
    label: `${verified} verified`,
    classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
}

function createEmptyBroker() {
  return {
    id: null,
    full_name: "",
    email: "",
    company_name: "",
    broker_phone: "",
    broker_address: "",
    broker_notes: "",
    assigned_shops: [],
    broker_credentials: DEFAULT_CREDENTIALS,
  };
}

export default function BrokerManager() {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brokers, setBrokers] = useState([]);
  const [shopOwners, setShopOwners] = useState([]);
  const [savingBrokerId, setSavingBrokerId] = useState(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [expandedBrokerId, setExpandedBrokerId] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [draft, setDraft] = useState(createEmptyBroker());

  useEffect(() => {
    if (!expanded) return;
    loadData();
  }, [expanded]);

  async function loadData() {
    setLoading(true);
    try {
      // Use admin function to bypass RLS and get all users
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;
      let allUsers = [];
      if (token) {
        const { data } = await supabase.functions.invoke("adminAction", {
          body: { action: "listUsers" },
          headers: { Authorization: `Bearer ${token}` },
        });
        allUsers = data?.users || [];
      }
      if (!allUsers.length) {
        allUsers = await base44.entities.User.list();
      }

      const brokerUsers = allUsers
        .filter((u) => u.role === "broker")
        .map((u) => ({
          ...u,
          broker_phone: u.broker_phone || "",
          broker_address: u.broker_address || "",
          broker_notes: u.broker_notes || "",
          assigned_shops: Array.isArray(u.assigned_shops) ? u.assigned_shops : [],
          broker_credentials: normalizeCredentials(u.broker_credentials),
        }));

      const owners = allUsers.filter((u) => u.role === "admin" || u.role === "user");

      const nameKey = (u) => u.full_name || u.company_name || u.email || "";
      setBrokers([...brokerUsers].sort((a, b) => nameKey(a).localeCompare(nameKey(b), undefined, { sensitivity: 'base' })));
      setShopOwners([...owners].sort((a, b) => nameKey(a).localeCompare(nameKey(b), undefined, { sensitivity: 'base' })));
    } catch (error) {
      console.error("Failed to load broker data:", error);
      setMessage("Error loading broker data");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setLoading(false);
    }
  }

  const filteredBrokers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brokers;

    return brokers.filter((broker) => {
      return (
        (broker.full_name || "").toLowerCase().includes(q) ||
        (broker.email || "").toLowerCase().includes(q) ||
        (broker.company_name || "").toLowerCase().includes(q) ||
        (broker.assigned_shops || []).some((email) =>
          email.toLowerCase().includes(q)
        )
      );
    });
  }, [brokers, query]);

  function openCreateBroker() {
    setDraft(createEmptyBroker());
    setEditorOpen(true);
  }

  function openEditBroker(broker) {
    setDraft({
      ...broker,
      assigned_shops: Array.isArray(broker.assigned_shops) ? broker.assigned_shops : [],
      broker_credentials: normalizeCredentials(broker.broker_credentials),
    });
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setDraft(createEmptyBroker());
  }

  function updateDraft(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function updateCredential(type, field, value) {
    setDraft((prev) => ({
      ...prev,
      broker_credentials: normalizeCredentials(prev.broker_credentials).map((cred) =>
        cred.type === type ? { ...cred, [field]: value } : cred
      ),
    }));
  }

  async function handleSaveBroker() {
    setEditorSaving(true);

    try {
      if (!draft.email?.trim()) {
        setMessage("Broker email is required");
        setTimeout(() => setMessage(""), 3000);
        setEditorSaving(false);
        return;
      }

      const payload = {
        full_name: draft.full_name,
        email: draft.email.trim().toLowerCase(),
        role: "broker",
        company_name: draft.company_name,
        broker_phone: draft.broker_phone,
        broker_address: draft.broker_address,
        broker_notes: draft.broker_notes,
        assigned_shops: Array.isArray(draft.assigned_shops) ? draft.assigned_shops : [],
        broker_credentials: normalizeCredentials(draft.broker_credentials),
      };

      let saved;

      if (!draft.id) {
        const existingUsers = await base44.entities.User.list();
        const existing = existingUsers.find(
          (u) => (u.email || "").toLowerCase() === payload.email.toLowerCase()
        );

        if (existing) {
          saved = await base44.entities.User.update(existing.id, payload);
        } else {
          saved = await base44.entities.User.create(payload);
        }
      } else {
        saved = await base44.entities.User.update(draft.id, payload);
      }

      await loadData();

      setMessage(
        draft.id
          ? "Broker saved"
          : "Broker created. They can now sign in using this exact email address."
      );
      setTimeout(() => setMessage(""), 3500);
      setExpandedBrokerId(saved.id);
      closeEditor();
    } catch (error) {
      console.error("Failed to save broker:", error);
      setMessage("Error saving broker");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setEditorSaving(false);
    }
  }

  async function toggleShopAssignment(broker, shopEmail) {
    const current = Array.isArray(broker.assigned_shops) ? broker.assigned_shops : [];
    const updated = current.includes(shopEmail)
      ? current.filter((e) => e !== shopEmail)
      : [...current, shopEmail];

    setSavingBrokerId(broker.id);
    try {
      await base44.entities.User.update(broker.id, { assigned_shops: updated, role: "broker" });
      setBrokers((prev) =>
        prev.map((b) =>
          b.id === broker.id ? { ...b, assigned_shops: updated } : b
        )
      );
      setMessage("Assignment saved");
      setTimeout(() => setMessage(""), 2000);
    } catch (error) {
      console.error("Failed to update shop assignment:", error);
      setMessage("Error saving assignment");
      setTimeout(() => setMessage(""), 3000);
    } finally {
      setSavingBrokerId(null);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-6">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-slate-900">Broker Management</h3>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {message && (
            <div
              className={`text-sm font-semibold py-2 px-3 rounded-lg ${
                message.toLowerCase().includes("error")
                  ? "bg-red-50 text-red-600"
                  : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {message}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-base font-semibold text-slate-900">
                  Manage broker details, assignments, and credentials
                </div>
                <div className="text-sm text-slate-500 mt-1">
                  New brokers are activated by creating a User record with role = broker.
                </div>
              </div>

              <button
                onClick={openCreateBroker}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition"
              >
                <Plus className="w-4 h-4" />
                Add Broker
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search brokers, companies, emails, or assigned shops..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {loading ? (
            <div className="text-slate-400 text-sm">Loading brokers…</div>
          ) : filteredBrokers.length === 0 ? (
            <div className="text-slate-400 text-sm bg-slate-50 rounded-xl px-4 py-6 text-center border border-slate-200">
              No broker accounts found.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredBrokers.map((broker) => {
                const brokerHealth = getBrokerHealth(broker);
                const brokerCredentials = normalizeCredentials(broker.broker_credentials);
                const isOpen = expandedBrokerId === broker.id;

                return (
                  <div
                    key={broker.id}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setExpandedBrokerId(isOpen ? null : broker.id)
                      }
                      className="w-full text-left p-4 sm:p-5"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="text-lg font-semibold text-slate-900">
                              {broker.full_name || broker.email}
                            </div>
                            <div
                              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${brokerHealth.classes}`}
                            >
                              {brokerHealth.label}
                            </div>
                          </div>

                          <div className="mt-2 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
                            <div className="flex items-center gap-2 min-w-0">
                              <Mail className="w-4 h-4" />
                              <span className="truncate">{broker.email}</span>
                            </div>
                            <div className="flex items-center gap-2 min-w-0">
                              <Building2 className="w-4 h-4" />
                              <span className="truncate">{broker.company_name || "No company"}</span>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {(broker.assigned_shops || []).length > 0 ? (
                              broker.assigned_shops.map((shopEmail) => {
                                const shop = shopOwners.find((s) => s.email === shopEmail);
                                return (
                                  <span
                                    key={shopEmail}
                                    className="inline-flex items-center gap-1 bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded-full"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {shop?.shop_name || shopEmail}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="inline-flex items-center bg-slate-100 text-slate-500 text-xs font-semibold px-3 py-1.5 rounded-full">
                                No assigned shops
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 min-w-[220px] text-center">
                            <div>
                              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                                Verified
                              </div>
                              <div className="text-lg font-semibold text-slate-900">
                                {brokerCredentials.filter((c) => c.status === "verified").length}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                                Pending
                              </div>
                              <div className="text-lg font-semibold text-slate-900">
                                {brokerCredentials.filter((c) => c.status === "pending").length}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                                Issues
                              </div>
                              <div className="text-lg font-semibold text-slate-900">
                                {
                                  brokerCredentials.filter(
                                    (c) => c.status === "missing" || c.status === "expired"
                                  ).length
                                }
                              </div>
                            </div>
                          </div>

                          {isOpen ? (
                            <ChevronUp className="w-5 h-5 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-100 p-4 sm:p-5 grid gap-5 xl:grid-cols-[1.05fr_1fr]">
                        <div className="space-y-5">
                          <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/40">
                            <div className="flex items-center justify-between gap-3 mb-4">
                              <div className="text-base font-semibold text-slate-900">
                                Broker Details
                              </div>
                              <button
                                onClick={() => openEditBroker(broker)}
                                className="text-sm font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
                              >
                                Edit Info
                              </button>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-2">
                                  <Phone className="w-3.5 h-3.5" />
                                  Phone
                                </div>
                                <div className="text-sm text-slate-700 font-medium">
                                  {broker.broker_phone || "—"}
                                </div>
                              </div>

                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-2">
                                  <Mail className="w-3.5 h-3.5" />
                                  Email
                                </div>
                                <div className="text-sm text-slate-700 font-medium">
                                  {broker.email || "—"}
                                </div>
                              </div>

                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-2">
                                  <Building2 className="w-3.5 h-3.5" />
                                  Company
                                </div>
                                <div className="text-sm text-slate-700 font-medium">
                                  {broker.company_name || "—"}
                                </div>
                              </div>

                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-2">
                                  <MapPin className="w-3.5 h-3.5" />
                                  Address
                                </div>
                                <div className="text-sm text-slate-700 font-medium">
                                  {broker.broker_address || "—"}
                                </div>
                              </div>

                              <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                                  Notes
                                </div>
                                <div className="text-sm text-slate-700">
                                  {broker.broker_notes || "No notes added."}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/40">
                            <div className="text-base font-semibold text-slate-900 mb-4">
                              Assigned Shops
                            </div>

                            {shopOwners.length === 0 ? (
                              <div className="text-sm text-slate-400">No shop owners found.</div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {shopOwners.map((shop) => {
                                  const assigned = (broker.assigned_shops || []).includes(shop.email);
                                  return (
                                    <button
                                      key={shop.email}
                                      onClick={() => toggleShopAssignment(broker, shop.email)}
                                      disabled={savingBrokerId === broker.id}
                                      className={`text-sm font-semibold px-3 py-2 rounded-full border transition ${
                                        assigned
                                          ? "bg-indigo-600 text-white border-indigo-600"
                                          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                                      }`}
                                    >
                                      {assigned ? "✓ " : ""}
                                      {shop.shop_name || shop.email}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50/40">
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div className="text-base font-semibold text-slate-900">
                              Credentials
                            </div>
                            <button
                              onClick={() => openEditBroker(broker)}
                              className="text-sm font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition"
                            >
                              Manage Credentials
                            </button>
                          </div>

                          <div className="space-y-3">
                            {brokerCredentials.map((cred) => (
                              <div
                                key={cred.type}
                                className="rounded-xl border border-slate-200 bg-white p-4"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                      {cred.title}
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">
                                      {cred.file || "No file uploaded yet"}
                                    </div>
                                  </div>

                                  <div
                                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${getStatusPill(
                                      cred.status
                                    )}`}
                                  >
                                    {getStatusIcon(cred.status)}
                                    {cred.status}
                                  </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div className="rounded-lg bg-slate-50 p-3">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                                      Number
                                    </div>
                                    <div className="text-sm text-slate-700 font-medium mt-1">
                                      {cred.number || "—"}
                                    </div>
                                  </div>

                                  <div className="rounded-lg bg-slate-50 p-3">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                                      State
                                    </div>
                                    <div className="text-sm text-slate-700 font-medium mt-1">
                                      {cred.state || "—"}
                                    </div>
                                  </div>

                                  <div className="rounded-lg bg-slate-50 p-3">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                                      Expiration
                                    </div>
                                    <div className="text-sm text-slate-700 font-medium mt-1">
                                      {formatDate(cred.expiration)}
                                    </div>
                                  </div>

                                  <div className="rounded-lg bg-slate-50 p-3">
                                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                                      Verified On
                                    </div>
                                    <div className="text-sm text-slate-700 font-medium mt-1">
                                      {formatDate(cred.verified_at)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {editorOpen && (
            <ModalBackdrop
              onClose={() => setEditorOpen(false)}
              z="z-50"
              dismissOnBackdropClick={false}
            >
              <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl">
                <div className="p-5 sm:p-6 border-b border-slate-100">
                  <div className="text-xl font-semibold text-slate-900">
                    {draft.id ? "Edit Broker" : "Add Broker"}
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    {draft.id
                      ? "Update broker information, shop assignments, and compliance credentials."
                      : "Create and activate a new broker user so they can sign in with this exact email."}
                  </div>
                </div>

                <div className="p-5 sm:p-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-base font-semibold text-slate-900 mb-4">
                        Profile
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Name
                          </label>
                          <input
                            value={draft.full_name || ""}
                            onChange={(e) => updateDraft("full_name", e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Email
                          </label>
                          <input
                            value={draft.email || ""}
                            onChange={(e) => updateDraft("email", e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            placeholder="broker@email.com"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Phone
                          </label>
                          <input
                            value={draft.broker_phone || ""}
                            onChange={(e) => updateDraft("broker_phone", e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Company
                          </label>
                          <input
                            value={draft.company_name || ""}
                            onChange={(e) => updateDraft("company_name", e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Address
                          </label>
                          <input
                            value={draft.broker_address || ""}
                            onChange={(e) => updateDraft("broker_address", e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Notes
                          </label>
                          <textarea
                            value={draft.broker_notes || ""}
                            onChange={(e) => updateDraft("broker_notes", e.target.value)}
                            rows={4}
                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-base font-semibold text-slate-900 mb-4">
                        Assigned Shops
                      </div>

                      {shopOwners.length === 0 ? (
                        <div className="text-sm text-slate-400">No shop owners found.</div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {shopOwners.map((shop) => {
                            const active = (draft.assigned_shops || []).includes(shop.email);
                            return (
                              <button
                                key={shop.email}
                                type="button"
                                onClick={() =>
                                  updateDraft(
                                    "assigned_shops",
                                    active
                                      ? draft.assigned_shops.filter((s) => s !== shop.email)
                                      : [...draft.assigned_shops, shop.email]
                                  )
                                }
                                className={`text-sm font-semibold px-3 py-2 rounded-full border transition ${
                                  active
                                    ? "bg-indigo-600 text-white border-indigo-600"
                                    : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                                }`}
                              >
                                {active ? "✓ " : ""}
                                {shop.shop_name || shop.email}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="text-base font-semibold text-slate-900 mb-4">
                      Credentials
                    </div>

                    <div className="space-y-4">
                      {normalizeCredentials(draft.broker_credentials).map((cred) => (
                        <div
                          key={cred.type}
                          className="rounded-xl border border-slate-200 p-4"
                        >
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                              <div className="font-semibold text-slate-900">
                                {cred.title}
                              </div>
                              <div className="text-xs text-slate-400 mt-1">
                                Track upload, status, expiration, and verification.
                              </div>
                            </div>

                            <div
                              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${getStatusPill(
                                cred.status
                              )}`}
                            >
                              {getStatusIcon(cred.status)}
                              {cred.status}
                            </div>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Status
                              </label>
                              <select
                                value={cred.status}
                                onChange={(e) =>
                                  updateCredential(cred.type, "status", e.target.value)
                                }
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="missing">Missing</option>
                                <option value="pending">Pending</option>
                                <option value="verified">Verified</option>
                                <option value="expired">Expired</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">
                                File
                              </label>
                              <div className="relative">
                                <Upload className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                  value={cred.file || ""}
                                  onChange={(e) =>
                                    updateCredential(cred.type, "file", e.target.value)
                                  }
                                  placeholder="file name or uploaded doc url"
                                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Number
                              </label>
                              <input
                                value={cred.number || ""}
                                onChange={(e) =>
                                  updateCredential(cred.type, "number", e.target.value)
                                }
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">
                                State
                              </label>
                              <input
                                value={cred.state || ""}
                                onChange={(e) =>
                                  updateCredential(cred.type, "state", e.target.value)
                                }
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Expiration
                              </label>
                              <input
                                type="date"
                                value={cred.expiration || ""}
                                onChange={(e) =>
                                  updateCredential(cred.type, "expiration", e.target.value)
                                }
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Verified On
                              </label>
                              <input
                                type="date"
                                value={cred.verified_at || ""}
                                onChange={(e) =>
                                  updateCredential(cred.type, "verified_at", e.target.value)
                                }
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-5 sm:p-6 border-t border-slate-100 flex items-center justify-end gap-3">
                  <button
                    onClick={closeEditor}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveBroker}
                    disabled={editorSaving}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold px-4 py-2.5 rounded-xl transition"
                  >
                    <Save className="w-4 h-4" />
                    {editorSaving ? "Saving..." : draft.id ? "Save Broker" : "Create Broker"}
                  </button>
                </div>
              </div>
            </ModalBackdrop>
          )}
        </div>
      )}
    </div>
  );
}