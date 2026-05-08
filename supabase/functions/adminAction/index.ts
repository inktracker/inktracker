import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        .select("id, auth_id, role, shop_name, logo_url, created_at, email, shop_owner, assigned_shops, full_name")
        .or(`auth_id.eq.${user.id},shop_owner.eq.${adminEmail},assigned_shops.cs.["${adminEmail}"]`)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      // Fetch auth emails via admin API
      let emailMap: Record<string, string> = {};
      try {
        const { data: authUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        if (authUsers?.users) {
          for (const u of authUsers.users) {
            emailMap[u.id] = u.email ?? "";
          }
        }
      } catch (emailErr) {
        console.warn("Could not fetch emails:", emailErr);
        // Non-fatal — continue without emails
      }

      const enriched = profiles.map((p: { auth_id: string }) => ({
        ...p,
        email: emailMap[p.auth_id] || "",
      }));

      return new Response(JSON.stringify({ users: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "setRole") {
      if (!role) {
        return new Response(JSON.stringify({ error: "role required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { authId } = body;

      const adminEmail = callerProfile?.email || user.email;
      let data, error;
      if (!profileId && authId) {
        ({ data, error } = await adminClient
          .from("profiles")
          .insert({ auth_id: authId, role, shop_name: callerProfile?.shop_name || "", shop_owner: adminEmail, created_at: new Date().toISOString() })
          .select()
          .single());
      } else if (profileId) {
        ({ data, error } = await adminClient
          .from("profiles")
          .update({ role, shop_owner: adminEmail })
          .eq("id", profileId)
          .select()
          .single());
      } else {
        return new Response(JSON.stringify({ error: "profileId or authId required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (error) {
        console.error("setRole error:", JSON.stringify(error));
        return new Response(JSON.stringify({ error: error.message || "Failed to set role", detail: JSON.stringify(error) }), {
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
      const cleanEmail = (email ?? "").trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return new Response(JSON.stringify({ error: "Valid email required" }), {
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
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send the invite via Supabase Auth admin API FIRST — that's the most
      // likely thing to fail (rate limits, SMTP config, etc). If it succeeds,
      // create the pre-linked profile.
      const appUrl = Deno.env.get("APP_URL");
      const redirectPage = assignRole === "broker" ? "BrokerOnboarding" : assignRole === "employee" ? "ShopFloor" : assignRole === "manager" ? "Dashboard" : "Dashboard";
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

    if (action === "deleteUser") {
      const { authId } = body;
      const adminEmail = callerProfile?.email || user.email;
      if (!profileId && !authId) {
        return new Response(JSON.stringify({ error: "profileId or authId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the target user belongs to this admin's shop before deleting
      const targetQuery = profileId
        ? adminClient.from("profiles").select("auth_id, email, shop_owner, assigned_shops").eq("id", profileId).single()
        : adminClient.from("profiles").select("auth_id, email, shop_owner, assigned_shops").eq("auth_id", authId).single();
      const { data: targetProfile } = await targetQuery;

      if (targetProfile) {
        const isOwnShop = targetProfile.shop_owner === adminEmail ||
          (Array.isArray(targetProfile.assigned_shops) && targetProfile.assigned_shops.includes(adminEmail));
        if (!isOwnShop && targetProfile.email !== adminEmail) {
          return new Response(JSON.stringify({ error: "Cannot delete a user from another shop" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      let resolvedAuthId = authId;
      if (profileId) {
        const { data: profile } = await adminClient
          .from("profiles")
          .select("auth_id")
          .eq("id", profileId)
          .single();
        resolvedAuthId = profile?.auth_id || authId;
      }

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
