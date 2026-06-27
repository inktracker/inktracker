import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAdminTargetAccess } from "../_shared/adminTargetAccess.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client: bypasses RLS entirely, needed for auth.admin.*
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Validate the caller's JWT via a user-scoped client (auth endpoint ignores RLS)
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service-role client to look up profile — avoids any RLS restrictions
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, email, shop_name")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (callerProfile?.role !== "admin" && callerProfile?.role !== "shop") {
      return new Response(JSON.stringify({ error: "Forbidden: admin only", yourRole: callerProfile?.role ?? null }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, profileId, role } = body;

    if (action === "listUsers") {
      const adminEmail = callerProfile?.email || user.email;
      // Query only profiles belonging to this admin's shop — scoped at DB level
      const { data: profiles, error } = await adminClient
        .from("profiles")
        .select("id, auth_id, role, shop_name, logo_url, created_at, email, shop_owner, assigned_shops, full_name, manager_permissions")
        .or(`auth_id.eq.${user.id},shop_owner.eq.${adminEmail},assigned_shops.cs.["${adminEmail}"]`)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      // Fetch auth user data via admin API — emails + last_sign_in_at so the
      // admin UI can tell which invites are still unaccepted ("Pending invite"
      // = auth row exists but user has never signed in).
      let emailMap: Record<string, string> = {};
      let lastSignInMap: Record<string, string | null> = {};
      try {
        const { data: authUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        if (authUsers?.users) {
          for (const u of authUsers.users) {
            emailMap[u.id] = u.email ?? "";
            lastSignInMap[u.id] = u.last_sign_in_at ?? null;
          }
        }
      } catch (emailErr) {
        console.warn("Could not fetch emails:", emailErr);
        // Non-fatal — continue without emails
      }

      const enriched = profiles.map((p: { auth_id: string }) => ({
        ...p,
        email: emailMap[p.auth_id] || "",
        last_sign_in_at: lastSignInMap[p.auth_id] || null,
      }));

      return new Response(JSON.stringify({ users: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "setManagerPermissions") {
      // Owner sets which sections a manager can see. permissions is a
      // map { SectionKey: bool } or null (= full access). Tenant-checked
      // the same way as setRole so an admin can only touch their own
      // shop's managers.
      const { permissions } = body;
      if (!profileId) {
        return new Response(JSON.stringify({ error: "profileId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminEmail = callerProfile?.email || user.email;
      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("shop_owner, assigned_shops, email, role")
        .eq("id", profileId)
        .maybeSingle();
      const access = checkAdminTargetAccess({ targetProfile, adminEmail });
      if (!access.ok) {
        const status = access.reason === "not_found" ? 404 : 403;
        return new Response(JSON.stringify({
          error: access.reason === "not_found" ? "Target user not found" : "Cannot change permissions on a user from another shop",
        }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (targetProfile!.role !== "manager") {
        return new Response(JSON.stringify({ error: "Permissions only apply to managers." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await adminClient
        .from("profiles")
        .update({ manager_permissions: permissions ?? null })
        .eq("id", profileId)
        .select()
        .single();
      if (error) {
        return new Response(JSON.stringify({ error: error.message || "Failed to set permissions" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, profile: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "setRole") {
      if (!role) {
        return new Response(JSON.stringify({ error: "role required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { authId } = body;

      const adminEmail = callerProfile?.email || user.email;
      let data, error;
      if (!profileId && authId) {
        // setRole expects an existing profile. If the authId has no profile,
        // we MUST NOT create a new one from this code path — doing so would
        // let any authenticated shop claim an orphan auth identity into their
        // tenant. Use `inviteBroker` to create new users; `setRole` only
        // mutates roles on profiles that already exist.
        const { data: existingForAuth } = await adminClient
          .from("profiles")
          .select("id, shop_owner, assigned_shops, email")
          .eq("auth_id", authId)
          .maybeSingle();
        const access = checkAdminTargetAccess({ targetProfile: existingForAuth, adminEmail });
        if (!access.ok) {
          const status = access.reason === "not_found" ? 404 : 403;
          const msg = access.reason === "not_found"
            ? "No profile exists for that auth user. Use 'inviteBroker' to create one."
            : "Cannot set role on a user from another shop";
          return new Response(JSON.stringify({ error: msg }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        ({ data, error } = await adminClient
          .from("profiles")
          .update({ role })
          .eq("id", existingForAuth!.id)
          .select()
          .single());
      } else if (profileId) {
        // Verify the target profile belongs to this admin's shop before
        // touching it. Without this check, any shop could change the role
        // of (and steal — the update sets shop_owner: adminEmail) any
        // profile in any other shop. Same shape as the deleteUser check
        // below.
        const { data: targetProfile } = await adminClient
          .from("profiles")
          .select("shop_owner, assigned_shops, email")
          .eq("id", profileId)
          .maybeSingle();
        const access = checkAdminTargetAccess({ targetProfile, adminEmail });
        if (!access.ok) {
          const status = access.reason === "not_found" ? 404 : 403;
          const msg = access.reason === "not_found"
            ? "Target user not found"
            : "Cannot change role on a user from another shop";
          return new Response(JSON.stringify({ error: msg }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        ({ data, error } = await adminClient
          .from("profiles")
          .update({ role, shop_owner: adminEmail })
          .eq("id", profileId)
          .select()
          .single());
      } else {
        return new Response(JSON.stringify({ error: "profileId or authId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (error) {
        console.error("setRole error:", JSON.stringify(error));
        // Don't return the raw DB error (leaks schema/internals). Message only.
        return new Response(JSON.stringify({ error: error.message || "Failed to set role" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ profile: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "inviteBroker") {
      const { email, fullName, role: inviteRole } = body;
      const assignRole = inviteRole || "broker";
      // Allowlist the invitee role. Without this, a shop owner could invite a
      // user with role:"admin" (the platform-staff role that bypasses gates) or
      // any arbitrary string. Only the three tenant-scoped roles are invitable.
      const INVITABLE_ROLES = new Set(["broker", "employee", "manager"]);
      if (!INVITABLE_ROLES.has(assignRole)) {
        return new Response(JSON.stringify({ error: "Invalid role. You can invite a broker, employee, or manager." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const cleanEmail = (email ?? "").trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return new Response(JSON.stringify({ error: "Valid email required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Refuse if a profile with this email already exists
      const { data: existing } = await adminClient
        .from("profiles")
        .select("id, role, email, auth_id")
        .eq("email", cleanEmail)
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({
          error: `A ${existing.role} account already exists for ${cleanEmail}. Delete it first if you want to re-invite.`,
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send the invite via Supabase Auth admin API FIRST — that's the most
      // likely thing to fail (rate limits, SMTP config, etc). If it succeeds,
      // create the pre-linked profile.
      const appUrl = Deno.env.get("APP_URL");
      // Employees were going straight to /ShopFloor, which gated them
      // behind an email+password form they hadn't set up yet (magic
      // link sign-in invalidated as soon as the page rejected them).
      // Route them through EmployeeOnboarding to set a password first,
      // then it forwards to /ShopFloor.
      const redirectPage = assignRole === "broker" ? "BrokerOnboarding" : assignRole === "employee" ? "EmployeeOnboarding" : assignRole === "manager" ? "ManagerOnboarding" : "Dashboard";
      const redirectTo = appUrl ? `${appUrl}/${redirectPage}` : undefined;
      const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        cleanEmail,
        redirectTo ? { redirectTo } : undefined,
      );
      if (inviteErr) {
        console.error("inviteUserByEmail failed:", inviteErr);
        return new Response(JSON.stringify({
          error: `Failed to send invite: ${inviteErr.message}`,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Supabase auto-creates an auth.users row on invite — use its id so
      // the profile is already linked. This also fires handle_new_user; if
      // that trigger created a "user" profile, upgrade it to broker.
      const invitedAuthId = inviteData?.user?.id ?? null;

      if (invitedAuthId) {
        try {
          const { data: existingByAuth } = await adminClient
            .from("profiles")
            .select("id")
            .eq("auth_id", invitedAuthId)
            .maybeSingle();

          const assignedShops = user.email ? [user.email] : [];

          // Get admin's shop info so invited users inherit it
          const { data: adminProfile } = await adminClient
            .from("profiles")
            .select("shop_name, logo_url")
            .eq("auth_id", user.id)
            .maybeSingle();

          if (existingByAuth) {
            const updatePayload: any = {
              role: assignRole,
              full_name: fullName || null,
              email: cleanEmail,
              shop_name: adminProfile?.shop_name || "",
              shop_owner: user.email,
            };
            if (assignRole === "broker" || assignRole === "manager" || assignRole === "employee") updatePayload.assigned_shops = assignedShops;
            await adminClient
              .from("profiles")
              .update(updatePayload)
              .eq("id", existingByAuth.id);
          } else {
            const insertPayload: any = {
              auth_id: invitedAuthId,
              email: cleanEmail,
              role: assignRole,
              full_name: fullName || null,
              shop_name: adminProfile?.shop_name || "",
              shop_owner: user.email,
            };
            if (assignRole === "broker" || assignRole === "manager" || assignRole === "employee") insertPayload.assigned_shops = assignedShops;
            await adminClient.from("profiles").insert(insertPayload);
          }
        } catch (profileErr) {
          console.error("Profile create/update failed (invite was sent):", profileErr);
        }

        return new Response(JSON.stringify({ invited: true, email: cleanEmail, role: assignRole }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fallback: no auth id returned (shouldn't happen) — fall back to email-only profile
      const { data: profile, error: profileErr } = await adminClient
        .from("profiles")
        .insert({
          email: cleanEmail,
          role: "broker",
          full_name: fullName || null,
          assigned_shops: user.email ? [user.email] : [],
        })
        .select()
        .single();
      if (profileErr) throw profileErr;

      return new Response(JSON.stringify({ profile }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "resendInvite") {
      // Re-send the Supabase invite email for a user who hasn't accepted yet.
      // Tenant-guarded: target must be in the admin's shop (broker assigned
      // to them OR employee/manager with shop_owner = admin.email).
      const { email } = body;
      const cleanEmail = (email ?? "").trim().toLowerCase();
      if (!cleanEmail) {
        return new Response(JSON.stringify({ error: "Email required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: target } = await adminClient
        .from("profiles")
        .select("id, role, email, shop_owner, assigned_shops, auth_id")
        .eq("email", cleanEmail)
        .maybeSingle();
      if (!target) {
        return new Response(JSON.stringify({ error: "No user with that email" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminEmail = callerProfile?.email || user.email;
      const access = checkAdminTargetAccess({ targetProfile: target, adminEmail });
      if (!access.ok) {
        return new Response(JSON.stringify({ error: "Cannot re-invite a user from another shop" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const appUrl = Deno.env.get("APP_URL");
      const redirectPage = target.role === "broker"
        ? "BrokerOnboarding"
        : target.role === "employee"
          ? "ShopFloor"
          : "Dashboard";
      const redirectTo = appUrl ? `${appUrl}/${redirectPage}` : undefined;
      const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        cleanEmail,
        redirectTo ? { redirectTo } : undefined,
      );
      if (inviteErr) {
        return new Response(JSON.stringify({ error: `Resend failed: ${inviteErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ resent: true, email: cleanEmail }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "deleteUser") {
      const { authId } = body;
      const adminEmail = callerProfile?.email || user.email;
      if (!profileId && !authId) {
        return new Response(JSON.stringify({ error: "profileId or authId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the target user belongs to this admin's shop before deleting.
      // Uses maybeSingle so a missing target lands as null (not an error) and
      // the access check refuses cleanly. Pre-fix this was .single() + an
      // `if (targetProfile)` block — the null path skipped the tenant check
      // and let deleteUser proceed against any authId.
      const targetQuery = profileId
        ? adminClient.from("profiles").select("auth_id, email, shop_owner, assigned_shops").eq("id", profileId).maybeSingle()
        : adminClient.from("profiles").select("auth_id, email, shop_owner, assigned_shops").eq("auth_id", authId).maybeSingle();
      const { data: targetProfile } = await targetQuery;

      const access = checkAdminTargetAccess({ targetProfile, adminEmail });
      if (!access.ok) {
        const status = access.reason === "not_found" ? 404 : 403;
        const msg = access.reason === "not_found"
          ? "Target user not found"
          : "Cannot delete a user from another shop";
        return new Response(JSON.stringify({ error: msg }), {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // The tenant check above already fetched the target profile (including
      // auth_id), so no second roundtrip needed. Fall back to the caller-
      // provided authId only if the profile row had no auth_id (orphan
      // pre-created profile case).
      const resolvedAuthId = targetProfile!.auth_id || authId;

      // Delete the auth user (cascades to profile via ON DELETE CASCADE).
      if (resolvedAuthId) {
        await adminClient.auth.admin.deleteUser(resolvedAuthId);
      }

      // Always also delete the profile row by id — orphan profiles (auth_id=null,
      // e.g. admin pre-created) have no cascade path, so without this they'd
      // reappear on refresh.
      if (profileId) {
        await adminClient.from("profiles").delete().eq("id", profileId);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("adminAction error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
