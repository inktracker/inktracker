import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { event, data } = body;
    if (!data) return Response.json({ ok: true, skipped: "no data" });

    const entityName = event?.entity_name;
    const eventType = event?.type;

    // Only care about creates (and message creates)
    if (eventType !== "create") return Response.json({ ok: true, skipped: "not a create event" });

    // Only act if the record was created by a broker
    const brokerEmail = data.broker_id || data.from_email;
    if (!brokerEmail) return Response.json({ ok: true, skipped: "no broker_id" });

    // Fetch broker user info
    const allUsers = await base44.asServiceRole.entities.User.list();
    const broker = allUsers.find(u => u.email === brokerEmail && u.role === "broker");
    if (!broker) return Response.json({ ok: true, skipped: "not a broker" });

    // Determine shop_owner
    let shopOwner = data.shop_owner || null;

    // For messages, shop_owner is the to_email (admin side)
    if (entityName === "Message") {
      shopOwner = data.to_email || null;
      // Only notify if the message is FROM a broker TO an admin
      if (!shopOwner) return Response.json({ ok: true, skipped: "no to_email" });
      // Verify to_email is not a broker
      const toUser = allUsers.find(u => u.email === shopOwner);
      if (!toUser || toUser.role === "broker") return Response.json({ ok: true, skipped: "recipient is a broker" });
    }

    if (!shopOwner) return Response.json({ ok: true, skipped: "no shop_owner" });

    // Build notification payload
    let action, itemLabel;

    if (entityName === "Quote") {
      action = "submitted_quote";
      itemLabel = data.quote_id || data.customer_name || "New Quote";
    } else if (entityName === "Customer") {
      action = "added_client";
      itemLabel = data.name || "New Client";
    } else if (entityName === "Message") {
      action = "sent_message";
      itemLabel = (data.body || "").slice(0, 60) || "New Message";
    } else if (entityName === "BrokerDocument") {
      action = "uploaded_file";
      itemLabel = data.name || "New File";
    } else {
      return Response.json({ ok: true, skipped: "unrecognized entity" });
    }

    await base44.asServiceRole.entities.BrokerNotification.create({
      shop_owner: shopOwner,
      broker_id: brokerEmail,
      broker_name: broker.full_name || broker.display_name || brokerEmail,
      broker_company: broker.company_name || "",
      action,
      item_label: itemLabel,
      item_id: data.id || event?.entity_id || "",
      item_entity: entityName,
      read: false,
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("brokerNotificationTrigger error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});