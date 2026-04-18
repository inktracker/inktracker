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
      .select("role")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin only", role: callerProfile?.role ?? null }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, profileId, role } = body;

    if (action === "listUsers") {
      const { data: profiles, error } = await adminClient
        .from("profiles")
        .select("id, auth_id, role, shop_name, logo_url, created_at")
        .order("created_at", { ascending: false });

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

      // Also include auth users who signed up but have no profile yet
      const profileAuthIds = new Set(profiles.map((p: { auth_id: string }) => p.auth_id));
      const orphans = Object.entries(emailMap)
        .filter(([authId]) => !profileAuthIds.has(authId))
        .map(([authId, email]) => ({
          id: null,
          auth_id: authId,
          role: "user",
          shop_name: "",
          logo_url: null,
          created_at: null,
          email,
          _no_profile: true,
        }));

      return new Response(JSON.stringify({ users: [...enriched, ...orphans] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "setRole") {
      if (!role) {
        return new Response(JSON.stringify({ error: "role required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // profileId may be null for orphan auth users — use authId to upsert instead
      const { authId } = body;

      let data, error;
      if (!profileId && authId) {
        // No profile yet — create one
        ({ data, error } = await adminClient
          .from("profiles")
          .insert({ auth_id: authId, role, shop_name: "", created_at: new Date().toISOString() })
          .select()
          .single());
      } else if (profileId) {
        ({ data, error } = await adminClient
          .from("profiles")
          .update({ role })
          .eq("id", profileId)
          .select()
          .single());
      } else {
        return new Response(JSON.stringify({ error: "profileId or authId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (error) throw error;

      return new Response(JSON.stringify({ profile: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "inviteBroker") {
      const { email, fullName } = body;
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
      const redirectTo = Deno.env.get("APP_URL")
        ? `${Deno.env.get("APP_URL")}/BrokerOnboarding`
        : undefined;
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
        // handle_new_user may have already created a profile — upgrade it
        const { data: existingByAuth } = await adminClient
          .from("profiles")
          .select("id")
          .eq("auth_id", invitedAuthId)
          .maybeSingle();

        // Auto-assign the inviting admin's shop so the broker can see/submit
        // quotes against it immediately — no separate "Assign Shop" step.
        const assignedShops = user.email ? [user.email] : [];

        if (existingByAuth) {
          const { data: updated, error: updErr } = await adminClient
            .from("profiles")
            .update({
              role: "broker",
              full_name: fullName || null,
              email: cleanEmail,
              assigned_shops: assignedShops,
            })
            .eq("id", existingByAuth.id)
            .select()
            .single();
          if (updErr) throw updErr;
          return new Response(JSON.stringify({ profile: updated }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: profile, error: profileErr } = await adminClient
          .from("profiles")
          .insert({
            auth_id: invitedAuthId,
            email: cleanEmail,
            role: "broker",
            full_name: fullName || null,
            assigned_shops: assignedShops,
          })
          .select()
          .single();
        if (profileErr) throw profileErr;
        return new Response(JSON.stringify({ profile }), {
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
      if (!profileId && !authId) {
        return new Response(JSON.stringify({ error: "profileId or authId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
