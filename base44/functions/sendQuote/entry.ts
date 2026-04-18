import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { quoteId, customerEmail } = await req.json();

    if (!quoteId || !customerEmail) {
      return Response.json({ error: 'Missing quoteId or customerEmail' }, { status: 400 });
    }

    // Get the quote
    const quote = await base44.entities.Quote.filter({ id: quoteId });
    if (!quote || quote.length === 0) {
      return Response.json({ error: 'Quote not found' }, { status: 404 });
    }

    const q = quote[0];

    // Verify shop owner
    if (q.shop_owner !== user.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get shop info
    const shopUser = await base44.auth.me();
    const shopName = shopUser.shop_name || 'Our Shop';

    // Create public share link
    const shareLink = `${Deno.env.get('BASE44_APP_URL')}/QuoteRequest?quoteId=${q.id}&clientReview=true`;

    // Send email
    await base44.integrations.Core.SendEmail({
      to: customerEmail,
      subject: `Quote ${q.quote_id} from ${shopName}`,
      body: `Hello ${q.customer_name},

We're excited to share your quote! Please review the details below and click the link to approve and pay the deposit.

Quote ID: ${q.quote_id}
Total: $${(q.total || 0).toFixed(2)}

Review & Approve Quote:
${shareLink}

If you have any questions, please don't hesitate to reach out!

Best regards,
${shopName}`,
      from_name: shopName,
    });

    // Update quote with sent info
    await base44.entities.Quote.update(quoteId, {
      sent_to: customerEmail,
      sent_date: new Date().toISOString(),
      status: 'Pending'
    });

    return Response.json({ success: true, message: 'Quote sent successfully' });
  } catch (error) {
    console.error('Error sending quote:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});