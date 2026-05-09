import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Users, CheckCircle, Clock, Store, Trash2, RefreshCw, ShieldCheck, UserX, Mail, X } from "lucide-react";
import BrokerManager from "@/components/broker/BrokerManager";

function roleBadge(role) {
  const map = {
    admin:    { label: "Owner",    cls: "bg-violet-100 text-violet-700" },
    shop:     { label: "Owner",    cls: "bg-violet-100 text-violet-700" },
    manager:  { label: "Manager",  cls: "bg-emerald-100 text-emerald-700" },
    user:     { label: "Pending",  cls: "bg-amber-100 text-amber-700" },
    broker:   { label: "Broker",   cls: "bg-sky-100 text-sky-700" },
    employee: { label: "Employee", cls: "bg-indigo-100 text-indigo-700" },
  };
  const { label, cls } = map[role] ?? { label: role, cls: "bg-slate-100 text-slate-500" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export default function AdminPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, auth_id }
  const [tab, setTab] = useState("pending"); // pending | all
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("manager");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  // Redirect non-admins immediately
  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "shop") {
      navigate(createPageUrl("Dashboard"), { replace: true });
    }
  }, [user, navigate]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const { data, error: fnError } = await supabase.functions.invoke("adminAction", {
        body: { action: "listUsers" },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (fnError) throw fnError;
      setUsers([...(data.users ?? [])].sort((a, b) => ((a.full_name || a.email) || "").localeCompare((b.full_name || b.email) || "", undefined, { sensitivity: 'base' })));
    } catch (err) {
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === "admin" || user?.role === "shop") loadUsers();
  }, [user, loadUsers]);

  async function setRole(profileId, authId, role) {
    const key = profileId || authId;
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      const { data, error: fnError } = await supabase.functions.invoke("adminAction", {
        body: { action: "setRole", profileId, authId, role },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setUsers(prev =>
        prev.map(u => {
          const matchId = u.id === profileId || u.auth_id === authId;
          return matchId ? { ...u, id: data.profile?.id || u.id, role: data.profile?.role || role, _no_profile: false } : u;
        })
      );
    } catch (err) {
      alert("Failed: " + (err.message || err));
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }));
    }
  }

  async function handleInviteBroker() {
    setInviteError("");
    setInviteSuccess("");
    setInviteSending(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const { data, error: fnError } = await supabase.functions.invoke("adminAction", {
        body: {
          action: "inviteBroker",
          email: inviteEmail.trim(),
          fullName: inviteName.trim() || null,
          role: inviteRole,
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      setInviteName("");
      await loadUsers();
      setTimeout(() => {
        setShowInvite(false);
        setInviteSuccess("");
      }, 1500);
    } catch (err) {
      setInviteError(err?.message || "Failed to send invite");
    } finally {
      setInviteSending(false);
    }
  }

  async function deleteUser(profileId, authId) {
    if (profileId === user.id) {
      alert("You cannot delete your own account.");
      return;
    }
    const key = profileId || authId;
    setActionLoading(prev => ({ ...prev, [key]: true }));
    setConfirmDelete(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      await supabase.functions.invoke("adminAction", {
        body: { action: "deleteUser", profileId, authId },
        headers: { Authorization: `Bearer ${token}` },
      });

      setUsers(prev => prev.filter(u => u.id !== profileId && u.auth_id !== authId));
    } catch (err) {
      alert("Failed to delete user: " + (err.message || err));
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }));
    }
  }

  if (!user || (user.role !== "admin" && user.role !== "shop")) return null;

  const pending = users.filter(u => u.role === "user");
  const approved = users.filter(u => u.role === "shop");
  const others = users.filter(u => u.role !== "user" && u.role !== "shop");
  const displayed = tab === "pending" ? pending : users.filter(u => u.id !== user.id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-indigo-600" />
            Admin Panel
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage user access and shop accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowInvite(true); setInviteError(""); setInviteSuccess(""); }}
            className="flex items-center gap-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 transition"
          >
            <Mail className="w-4 h-4" />
            Invite User
          </button>
          <button
            onClick={loadUsers}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
          <div className="text-2xl font-bold text-amber-600">{pending.length}</div>
          <div className="text-xs font-medium text-slate-500 mt-0.5 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Pending approval
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
          <div className="text-2xl font-bold text-emerald-600">{approved.length}</div>
          <div className="text-xs font-medium text-slate-500 mt-0.5 flex items-center gap-1">
            <Store className="w-3.5 h-3.5" /> Active shops
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
          <div className="text-2xl font-bold text-slate-700">{users.length}</div>
          <div className="text-xs font-medium text-slate-500 mt-0.5 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> Total accounts
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-100">
          <button
            onClick={() => setTab("pending")}
            className={`flex-1 py-3 text-sm font-semibold transition ${tab === "pending" ? "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/40" : "text-slate-500 hover:text-slate-800"}`}
          >
            Pending Approval
            {pending.length > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5">{pending.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab("all")}
            className={`flex-1 py-3 text-sm font-semibold transition ${tab === "all" ? "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/40" : "text-slate-500 hover:text-slate-800"}`}
          >
            All Users
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
            <p className="text-sm font-medium">
              {tab === "pending" ? "No pending approvals — you're all caught up!" : "No users found"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {displayed.map(u => {
              const key = u.id || u.auth_id;
              return (
              <div key={key} className="flex items-center gap-4 px-5 py-4">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm shrink-0">
                  {(u.email || u.shop_name || "?")[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 text-sm truncate">
                    {u.full_name || u.shop_name || <span className="text-slate-400 italic">No name</span>}
                  </div>
                  <div className="text-xs text-slate-400 truncate">{u.email || u.auth_id}</div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                  </div>
                </div>

                {/* Role badge */}
                <div className="shrink-0">{roleBadge(u.role)}</div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {u.role === "user" && (
                    <>
                      <button
                        onClick={() => setRole(u.id, u.auth_id, "shop")}
                        disabled={actionLoading[key]}
                        className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        {actionLoading[key] ? "…" : "Approve"}
                      </button>
                      <button
                        onClick={() => setRole(u.id, u.auth_id, "broker")}
                        disabled={actionLoading[key]}
                        className="text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        {actionLoading[key] ? "…" : "Broker"}
                      </button>
                      <button
                        onClick={() => setRole(u.id, u.auth_id, "employee")}
                        disabled={actionLoading[key]}
                        className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                      >
                        {actionLoading[key] ? "…" : "Employee"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete({ id: u.id, auth_id: u.auth_id })}
                        disabled={actionLoading[key]}
                        className="text-xs text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 transition disabled:opacity-50"
                        title="Delete account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {(u.role === "shop" || u.role === "broker" || u.role === "employee") && (
                    <button
                      onClick={() => setRole(u.id, u.auth_id, "user")}
                      disabled={actionLoading[key]}
                      className="text-xs font-semibold border border-slate-200 text-slate-500 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                    >
                      {actionLoading[key] ? "…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Broker management */}
      <div className="pt-4">
        <BrokerManager />
      </div>

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center">
                <UserX className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <div className="font-semibold text-slate-900">Delete account?</div>
                <div className="text-xs text-slate-500">This cannot be undone.</div>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-5">
              The user's account will be permanently deleted from the system.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteUser(confirmDelete.id, confirmDelete.auth_id)}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white rounded-xl py-2 text-sm font-semibold transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvite && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !inviteSending) setShowInvite(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center">
                  <Mail className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">Invite User</div>
                  <div className="text-xs text-slate-500">Sends a sign-in email with the selected role.</div>
                </div>
              </div>
              <button
                onClick={() => !inviteSending && setShowInvite(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Email *</label>
                <input
                  type="email"
                  autoFocus
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="broker@example.com"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Full name (optional)</label>
                <input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Role</label>
                <div className="flex gap-2">
                  {[
                    { value: "manager", label: "Manager", color: "emerald" },
                    { value: "employee", label: "Employee", color: "indigo" },
                    { value: "broker", label: "Broker", color: "sky" },
                  ].map(r => (
                    <button key={r.value} type="button" onClick={() => setInviteRole(r.value)}
                      className={`flex-1 text-xs font-semibold py-2 rounded-lg border transition ${inviteRole === r.value ? `bg-${r.color}-600 text-white border-${r.color}-600` : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {inviteError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  {inviteSuccess}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => !inviteSending && setShowInvite(false)}
                disabled={inviteSending}
                className="flex-1 border border-slate-200 rounded-xl py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteBroker}
                disabled={inviteSending || !inviteEmail.trim()}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-xl py-2 text-sm font-semibold transition"
              >
                {inviteSending ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
