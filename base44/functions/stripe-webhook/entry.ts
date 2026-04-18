import Stripe from "npm:stripe@14.21.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"));

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const signature = req.headers.get("stripe-signature");
    const body = await req.text();

    // Verify signature and construct event
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")
    );

    console.log(`Processing event: ${event.type}`);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const quoteId = session.metadata?.quote_id;
      const customerEmail = session.metadata?.customer_email;
      const customerName = session.metadata?.customer_name;

      if (!quoteId) {
        console.error("No quote_id in webhook metadata");
        return Response.json({ error: "Missing quote_id" }, { status: 400 });
      }

      // Fetch quote using service role — quoteId here is the DB record id
      const allQuotes = await base44.asServiceRole.entities.Quote.list();
      const quotes = allQuotes.filter(q => q.id === quoteId);
      if (!quotes || quotes.length === 0) {
        console.error(`Quote not found: ${quoteId}`);
        return Response.json({ error: "Quote not found" }, { status: 404 });
      }

      const quote = quotes[0];
      const shopOwner = quote.shop_owner;
      const paidAmount = (session.amount_total ?? 0) / 100;

      // Update quote status
      await base44.asServiceRole.entities.Quote.update(quoteId, {
        status: "Approved and Paid",
        deposit_paid: true,
        sent_to: customerEmail,
        sent_date: new Date().toISOString(),
      });

      // Calculate totals (inline implementation)
      const calcTotals = (q) => {
        let sub = 0;
        (q.line_items || []).forEach((li) => {
          const qty = Object.values(li.sizes || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
          const garmentCost = parseFloat(li.garmentCost) || 0;
          const colors = li.imprints?.[0]?.colors || 1;
          const printPPP = colors === 1 ? 6.30 : colors === 2 ? 6.93 : 7.55;
          sub += (garmentCost * 1.4 + printPPP) * qty;
        });
        const afterDisc = sub * (1 - (parseFloat(q.discount) || 0) / 100);
        const tax = afterDisc * ((parseFloat(q.tax_rate) || 8.265) / 100);
        return { sub, afterDisc, tax, total: afterDisc + tax };
      };
      const totals = calcTotals(quote);
      const orderId = `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-5)}`;

      const order = await base44.asServiceRole.entities.Order.create({
        order_id: orderId,
        shop_owner: shopOwner,
        broker_id: quote.broker_id || "",
        customer_id: quote.customer_id,
        customer_name: quote.customer_name,
        date: quote.date,
        due_date: quote.due_date || "",
        status: "Art Approval",
        line_items: quote.line_items || [],
        notes: quote.notes || "",
        rush_rate: quote.rush_rate || 0,
        extras: quote.extras || {},
        discount: quote.discount || 0,
        tax_rate: quote.tax_rate || 8.265,
        subtotal: totals.sub,
        tax: totals.tax,
        total: totals.total,
        paid: true,
        paid_date: new Date().toISOString().split("T")[0],
        selected_artwork: quote.selected_artwork || [],
      });

      // Create commission for broker if applicable
      if (quote.broker_id) {
        const DEFAULT_PCT = 10;
        await base44.asServiceRole.entities.Commission.create({
          broker_id: quote.broker_id,
          broker_name: quote.broker_name || quote.broker_id,
          shop_owner: shopOwner,
          order_id: orderId,
          customer_name: quote.customer_name,
          order_total: totals.total,
          commission_pct: DEFAULT_PCT,
          commission_amount: (totals.total * DEFAULT_PCT) / 100,
          status: "Pending",
        });
      }

      // Fetch shop owner's profile to get their name and email
      const shopOwnerUsers = await base44.asServiceRole.entities.User.filter({ email: shopOwner });
      const shopOwnerUser = shopOwnerUsers?.[0] || null;
      const shopName = shopOwnerUser?.shop_name || shopOwner;
      const shopEmail = shopOwner;

      // Send notification email to admin via Gmail
      try {
        const readableQuoteNum = quote.quote_id || quoteId;
        const subject = `Payment Received - ${readableQuoteNum} - ${quote.customer_name}`;
        const body = [
          `Quote Number: ${readableQuoteNum}`,
          `Client Name: ${quote.customer_name}`,
          `Amount Paid: $${paidAmount.toFixed(2)}`,
          `Order Number: ${orderId}`,
          `Client Email: ${customerEmail || quote.customer_email || "N/A"}`,
        ].join("\n\n");

        const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");

        const emailLines = [
          `From: ${shopEmail}`,
          `To: ${shopEmail}`,
          `Subject: ${subject}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          body,
        ];
        const raw = btoa(unescape(encodeURIComponent(emailLines.join("\r\n"))))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

        const gmailRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ raw }),
          }
        );

        if (!gmailRes.ok) {
          const err = await gmailRes.text();
          console.warn("Gmail send failed:", err);
        } else {
          console.log("Payment confirmation email sent via Gmail.");
        }
      } catch (emailErr) {
        console.warn("Failed to send notification email:", emailErr.message);
      }

      // Send confirmation email to client via Gmail
      const clientEmail = customerEmail || quote.customer_email;
      if (clientEmail) {
        try {
          const readableQuoteNum = quote.quote_id || quoteId;
          const clientSubject = `Payment Confirmed - ${readableQuoteNum}`;
          const clientBody = [
            `Hi ${quote.customer_name},`,
            `Thank you for your payment! We have received it and your order is now in production.`,
            `Quote Number: ${readableQuoteNum}`,
            `Amount Paid: $${paidAmount.toFixed(2)}`,
            `Order Number: ${orderId}`,
            `You will receive updates as your order progresses through production.`,
            `Thank you for your business!`,
            shopName,
          ].join("\n\n");

          const { accessToken: clientAccessToken } = await base44.asServiceRole.connectors.getConnection("gmail");

          const clientEmailLines = [
            `From: ${shopEmail}`,
            `To: ${clientEmail}`,
            `Subject: ${clientSubject}`,
            `Content-Type: text/plain; charset=utf-8`,
            ``,
            clientBody,
          ];
          const clientRaw = btoa(unescape(encodeURIComponent(clientEmailLines.join("\r\n"))))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

          const clientGmailRes = await fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${clientAccessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ raw: clientRaw }),
            }
          );

          if (!clientGmailRes.ok) {
            const err = await clientGmailRes.text();
            console.warn("Client Gmail send failed:", err);
          } else {
            console.log(`Client confirmation email sent to ${clientEmail}`);
          }
        } catch (clientEmailErr) {
          console.warn("Failed to send client confirmation email:", clientEmailErr.message);
        }
      }

      console.log(
        `Successfully processed quote ${quoteId}, created order ${orderId}`
      );
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});