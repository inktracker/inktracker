import Stripe from "npm:stripe@14.21.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "");

function sanitizeLineItems(lineItems = []) {
  if (!Array.isArray(lineItems)) return [];

  return lineItems
    .map((item) => {
      const quantity = Math.max(1, Number(item?.quantity || 0) || 1);
      const unitAmount = Math.max(1, Number(item?.unit_amount || 0) || 0);

      if (!unitAmount) return null;

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item?.name || "Quote Item",
            description: item?.description || "",
          },
          unit_amount: Math.round(unitAmount),
        },
        quantity,
      };
    })
    .filter((item) => item !== null);
}

async function getQuoteById(base44, quoteId) {
  try {
    const matches = await base44.asServiceRole.entities.Quote.filter({ id: quoteId }, "", 1);
    return Array.isArray(matches) && matches.length > 0 ? matches[0] : null;
  } catch (error) {
    console.error("Quote lookup failed:", error);
    return null;
  }
}

async function getCustomerById(base44, customerId) {
  if (!customerId) return null;

  try {
    const matches = await base44.asServiceRole.entities.Customer.filter(
      { id: customerId },
      "",
      1
    );
    return Array.isArray(matches) && matches.length > 0 ? matches[0] : null;
  } catch (error) {
    console.error("Customer lookup failed:", error);
    return null;
  }
}

async function getShopByOwnerEmail(base44, ownerEmail) {
  if (!ownerEmail) return null;

  try {
    const matches = await base44.asServiceRole.entities.Shop.filter(
      { owner_email: ownerEmail },
      "",
      1
    );
    return Array.isArray(matches) && matches.length > 0 ? matches[0] : null;
  } catch (error) {
    console.error("Shop lookup failed:", error);
    return null;
  }
}

async function getShopFromQuote(base44, quote, customer) {
  if (quote?.shop_owner) {
    const byQuoteOwner = await getShopByOwnerEmail(base44, quote.shop_owner);
    if (byQuoteOwner) return byQuoteOwner;
  }

  if (customer?.shop_owner) {
    const byCustomerOwner = await getShopByOwnerEmail(base44, customer.shop_owner);
    if (byCustomerOwner) return byCustomerOwner;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const action = String(body?.action || "createSession").trim();

    if (action === "getQuote") {
      const quoteId = String(body?.quoteId || "").trim();

      if (!quoteId) {
        return Response.json({ error: "Missing quoteId" }, { status: 400 });
      }

      const quote = await getQuoteById(base44, quoteId);

      if (!quote) {
        return Response.json({ error: "Quote not found" }, { status: 404 });
      }

      const customer = await getCustomerById(base44, quote.customer_id);
      const shop = await getShopFromQuote(base44, quote, customer);

      return Response.json({
        quote,
        customer,
        shop,
      });
    }

    if (action === "approveQuote") {
      const quoteId = String(body?.quoteId || "").trim();

      if (!quoteId) {
        return Response.json({ error: "Missing quoteId" }, { status: 400 });
      }

      const quote = await getQuoteById(base44, quoteId);

      if (!quote) {
        return Response.json({ error: "Quote not found" }, { status: 404 });
      }

      let updatedQuote = quote;

      if (
        quote.status !== "Approved" &&
        quote.status !== "Approved and Paid" &&
        quote.status !== "Paid"
      ) {
        updatedQuote = await base44.asServiceRole.entities.Quote.update(quote.id, {
          status: "Approved",
          approved_date: new Date().toISOString(),
        });
      }

      const customer = await getCustomerById(base44, updatedQuote.customer_id);
      const shop = await getShopFromQuote(base44, updatedQuote, customer);

      return Response.json({
        quote: updatedQuote,
        customer,
        shop,
      });
    }

    const quoteId = String(body?.quoteId || "").trim();
    const requestedLineItems = body?.lineItems || [];

    if (!quoteId) {
      return Response.json({ error: "Missing quoteId" }, { status: 400 });
    }

    const quote = await getQuoteById(base44, quoteId);

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    const quoteTotal = Number(body?.quoteTotal || quote?.total || 0);
    const customerEmail = String(
      body?.customerEmail || quote?.customer_email || quote?.sent_to || ""
    ).trim();
    const customerName = String(
      body?.customerName || quote?.customer_name || ""
    ).trim();
    const shopName = String(body?.shopName || "Shop").trim() || "Shop";

    if (!customerEmail) {
      return Response.json(
        { error: "Quote is missing a customer email address" },
        { status: 400 }
      );
    }

    let stripeLineItems = sanitizeLineItems(requestedLineItems);

    if (stripeLineItems.length === 0) {
      stripeLineItems = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Quote ${quote.quote_id || quoteId} - ${shopName}`,
              description: `Payment for quote ${quote.quote_id || quoteId}`,
            },
            unit_amount: Math.max(1, Math.round(quoteTotal * 100)),
          },
          quantity: 1,
        },
      ];
    }

    const origin =
      req.headers.get("origin") ||
      Deno.env.get("BASE44_APP_URL") ||
      "";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: stripeLineItems,
      customer_email: customerEmail,
      metadata: {
        base44_app_id: Deno.env.get("BASE44_APP_ID") || "",
        quote_id: String(quote.id),
        customer_email: customerEmail,
        customer_name: customerName,
      },
      success_url: `${origin}/quotepaymentsuccess?session_id={CHECKOUT_SESSION_ID}&quote_id=${quote.id}`,
      cancel_url: `${origin}/quotepaymentcancel?quote_id=${quote.id}`,
    });

    return Response.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error("Checkout error:", error);

    return Response.json(
      { error: error?.message || "Failed to process request" },
      { status: 500 }
    );
  }
});