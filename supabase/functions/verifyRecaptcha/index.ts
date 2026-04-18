// Verifies a Google reCAPTCHA v3 token server-side.
// Called from QuotePayment before allowing checkout.

const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token } = await req.json();

    if (!token) {
      return Response.json({ success: false, error: "No token provided" }, { status: 400, headers: CORS });
    }

    if (!RECAPTCHA_SECRET) {
      console.error("[verifyRecaptcha] RECAPTCHA_SECRET_KEY not set");
      return Response.json({ success: false, error: "Server misconfigured" }, { status: 500, headers: CORS });
    }

    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token }),
    });

    const data = await res.json();

    // v3 returns a score 0.0–1.0. Below 0.5 is likely a bot.
    if (!data.success || data.score < 0.5) {
      console.error("[verifyRecaptcha] Failed:", data);
      return Response.json({ success: false, score: data.score ?? 0 }, { headers: CORS });
    }

    return Response.json({ success: true, score: data.score }, { headers: CORS });
  } catch (err) {
    console.error("[verifyRecaptcha] Error:", err);
    return Response.json({ success: false, error: String(err.message ?? err) }, { status: 500, headers: CORS });
  }
});
