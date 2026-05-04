// FedEx Shipping — getRates, createShipment, trackShipment, validateAddress
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CORS, FEDEX_BASE, FEDEX_ACCOUNT_NUMBER, SHIPPER_ADDRESS, SHIPPER_CONTACT,
  fedexFetch,
} from "../_shared/fedex.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildRecipient(shipTo: any) {
  return {
    address: {
      streetLines: [shipTo.street].filter(Boolean),
      city: shipTo.city,
      stateOrProvinceCode: shipTo.state,
      postalCode: shipTo.zip,
      countryCode: shipTo.country || "US",
    },
    contact: {
      personName: shipTo.name || "",
      phoneNumber: shipTo.phone || "",
      companyName: shipTo.company || "",
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, accessToken } = body;

    // Authenticate caller
    const supaUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authErr } = await supaUser.auth.getUser(accessToken);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // ── validateAddress ────────────────────────────────────────────
    if (action === "validateAddress") {
      const { street, city, state, zip, country } = body;

      const { ok, data } = await fedexFetch(
        `${FEDEX_BASE}/address/v1/addresses/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            addressesToValidate: [{
              address: {
                streetLines: [street],
                city,
                stateOrProvinceCode: state,
                postalCode: zip,
                countryCode: country || "US",
              },
            }],
          }),
        },
        "fedex-validate",
      );

      if (!ok) return json({ error: "Address validation failed", detail: data }, 400);

      const resolved = data?.output?.resolvedAddresses?.[0];
      return json({
        valid: !!resolved,
        street: resolved?.streetLinesToken?.[0] || street,
        city: resolved?.city || city,
        state: resolved?.stateOrProvinceCode || state,
        zip: resolved?.postalCode || zip,
        country: resolved?.countryCode || country || "US",
        classification: resolved?.classification || "",
      });
    }

    // ── getRates ───────────────────────────────────────────────────
    if (action === "getRates") {
      const { shipTo, weight, length, width, height } = body;
      if (!shipTo?.street || !shipTo?.city || !shipTo?.state || !shipTo?.zip) {
        return json({ error: "Complete ship-to address required (street, city, state, zip)" }, 400);
      }
      if (!weight || parseFloat(weight) <= 0) {
        return json({ error: "Package weight is required" }, 400);
      }

      const requestBody = {
        accountNumber: { value: FEDEX_ACCOUNT_NUMBER },
        requestedShipment: {
          shipper: { address: SHIPPER_ADDRESS },
          recipient: buildRecipient(shipTo),
          pickupType: "DROPOFF_AT_FEDEX_LOCATION",
          rateRequestType: ["ACCOUNT", "LIST"],
          requestedPackageLineItems: [{
            weight: { units: "LB", value: parseFloat(weight) || 1 },
            dimensions: {
              length: parseInt(length) || 12,
              width: parseInt(width) || 12,
              height: parseInt(height) || 6,
              units: "IN",
            },
          }],
        },
      };

      const { ok, data } = await fedexFetch(
        `${FEDEX_BASE}/rate/v1/rates/quotes`,
        { method: "POST", body: JSON.stringify(requestBody) },
        "fedex-rates",
      );

      if (!ok) return json({ error: "Rate quote failed", detail: data }, 400);

      const rateDetails = data?.output?.rateReplyDetails || [];
      const rates = rateDetails.map((r: any) => {
        const charge = r.ratedShipmentDetails?.[0]?.totalNetCharge;
        return {
          serviceType: r.serviceType,
          serviceName: r.serviceName || r.serviceType,
          totalCharge: parseFloat(charge) || 0,
          currency: r.ratedShipmentDetails?.[0]?.currency || "USD",
          deliveryDate: r.commit?.dateDetail?.dayFormat || r.commit?.transitDays || "",
          transitDays: r.commit?.transitDays?.description || "",
        };
      });

      return json({ rates });
    }

    // ── createShipment ─────────────────────────────────────────────
    if (action === "createShipment") {
      const { shipTo, weight, length, width, height, serviceType, orderId, customerName } = body;
      if (!shipTo?.street || !shipTo?.city || !shipTo?.state || !shipTo?.zip) {
        return json({ error: "Complete ship-to address required (street, city, state, zip)" }, 400);
      }
      if (!weight || parseFloat(weight) <= 0) {
        return json({ error: "Package weight is required" }, 400);
      }
      if (!serviceType) {
        return json({ error: "Service type is required" }, 400);
      }

      const requestBody = {
        accountNumber: { value: FEDEX_ACCOUNT_NUMBER },
        labelResponseOptions: "LABEL",
        requestedShipment: {
          shipper: {
            address: SHIPPER_ADDRESS,
            contact: SHIPPER_CONTACT,
          },
          recipients: [buildRecipient(shipTo)],
          pickupType: "DROPOFF_AT_FEDEX_LOCATION",
          serviceType: serviceType || "FEDEX_GROUND",
          packagingType: "YOUR_PACKAGING",
          shippingChargesPayment: {
            paymentType: "SENDER",
          },
          labelSpecification: {
            labelFormatType: "COMMON2D",
            imageType: "PDF",
            labelStockType: "PAPER_4X6",
          },
          requestedPackageLineItems: [{
            weight: { units: "LB", value: parseFloat(weight) || 1 },
            dimensions: {
              length: parseInt(length) || 12,
              width: parseInt(width) || 12,
              height: parseInt(height) || 6,
              units: "IN",
            },
            customerReferences: orderId ? [{
              customerReferenceType: "CUSTOMER_REFERENCE",
              value: orderId,
            }] : [],
          }],
        },
      };

      const { ok, data } = await fedexFetch(
        `${FEDEX_BASE}/ship/v1/shipments`,
        { method: "POST", body: JSON.stringify(requestBody) },
        "fedex-ship",
      );

      if (!ok) return json({ error: "Shipment creation failed", detail: data }, 400);

      const piece = data?.output?.transactionShipments?.[0]?.pieceResponses?.[0];
      const trackingNumber = piece?.trackingNumber ||
        data?.output?.transactionShipments?.[0]?.masterTrackingNumber || "";
      const encodedLabel = piece?.packageDocuments?.[0]?.encodedLabel || "";

      let labelUrl = "";

      // Upload label PDF to Supabase Storage
      if (encodedLabel) {
        try {
          const labelBytes = Uint8Array.from(atob(encodedLabel), (c) => c.charCodeAt(0));
          const admin = adminClient();
          const filename = `${orderId || "label"}-${trackingNumber}.pdf`;

          const { error: uploadErr } = await admin.storage
            .from("shipping-labels")
            .upload(filename, labelBytes, {
              contentType: "application/pdf",
              upsert: true,
            });

          if (uploadErr) {
            console.error("[fedex-ship] label upload error:", uploadErr);
          } else {
            const { data: urlData } = admin.storage
              .from("shipping-labels")
              .getPublicUrl(filename);
            labelUrl = urlData?.publicUrl || "";
          }
        } catch (err) {
          console.error("[fedex-ship] label upload exception:", (err as Error).message);
        }
      }

      // Update order record with shipping info
      if (orderId) {
        try {
          const admin = adminClient();
          await admin.from("orders").update({
            tracking_number: trackingNumber,
            shipping_label_url: labelUrl,
            shipping_service_type: serviceType,
            shipping_carrier: "FedEx",
            shipping_status: "Label Created",
          }).eq("id", orderId);
        } catch (err) {
          console.error("[fedex-ship] order update failed:", (err as Error).message);
        }
      }

      return json({
        trackingNumber,
        labelUrl,
        encodedLabel: encodedLabel ? `data:application/pdf;base64,${encodedLabel}` : "",
      });
    }

    // ── trackShipment ──────────────────────────────────────────────
    if (action === "trackShipment") {
      const { trackingNumber } = body;

      const { ok, data } = await fedexFetch(
        `${FEDEX_BASE}/track/v1/trackingnumbers`,
        {
          method: "POST",
          body: JSON.stringify({
            includeDetailedScans: true,
            trackingInfo: [{
              trackingNumberInfo: { trackingNumber },
            }],
          }),
        },
        "fedex-track",
      );

      if (!ok) return json({ error: "Tracking failed", detail: data }, 400);

      const result = data?.output?.completeTrackResults?.[0]?.trackResults?.[0];
      const latestStatus = result?.latestStatusDetail;
      const events = (result?.scanEvents || []).map((e: any) => ({
        date: e.date,
        description: e.eventDescription,
        city: e.scanLocation?.city || "",
        state: e.scanLocation?.stateOrProvinceCode || "",
      }));

      return json({
        status: latestStatus?.statusByLocale || latestStatus?.code || "",
        description: latestStatus?.description || "",
        estimatedDelivery: result?.estimatedDeliveryTimeWindow?.window?.ends || "",
        events,
      });
    }

    return json({ error: "Unknown action" });
  } catch (err) {
    console.error("fedexShipping error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
