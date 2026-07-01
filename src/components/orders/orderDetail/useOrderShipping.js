import { useState, useEffect } from "react";
import { base44, supabase } from "@/api/supabaseClient";
import { notify } from "@/lib/notify";

// FedEx shipping state + handlers for the Order Detail modal, extracted
// verbatim from OrderDetailModal.jsx. Owns the shipping form state, the
// read-only sync for the tracking/label/status trio, and the four FedEx
// actions (rates, create label, save, track). Returns everything the
// OrderShippingSection component needs. Pure decomposition — no behavior
// change.
export function useOrderShipping(order) {
  const [showShipping, setShowShipping] = useState(false);
  const [shipStreet, setShipStreet] = useState(order.shipping_address_street || "");
  const [shipCity, setShipCity] = useState(order.shipping_address_city || "");
  const [shipState, setShipState] = useState(order.shipping_address_state || "");
  const [shipZip, setShipZip] = useState(order.shipping_address_zip || "");
  const [shipCountry, setShipCountry] = useState(order.shipping_address_country || "US");
  const [shipWeight, setShipWeight] = useState(order.shipping_weight || "");
  const [shipLength, setShipLength] = useState(order.shipping_length || "");
  const [shipWidth, setShipWidth] = useState(order.shipping_width || "");
  const [shipHeight, setShipHeight] = useState(order.shipping_height || "");
  const [shipService, setShipService] = useState(order.shipping_service_type || "");
  const [shipRates, setShipRates] = useState([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [shipTracking, setShipTracking] = useState(order.tracking_number || "");
  const [shipLabelUrl, setShipLabelUrl] = useState(order.shipping_label_url || "");
  const [shipStatus, setShipStatus] = useState(order.shipping_status || "");
  // Read-only sync for the shipping result trio. These get written by
  // the in-modal "Create Label" / "Track Shipment" actions but can also
  // arrive externally (FedEx webhook, label created from another tab).
  // The shipping FORM inputs above (address, weight, dims) deliberately
  // DON'T sync — they're user-editable and would clobber in-progress
  // edits if the order prop refreshed mid-typing.
  useEffect(() => { setShipTracking(order.tracking_number || ""); }, [order.tracking_number]);
  useEffect(() => { setShipLabelUrl(order.shipping_label_url || ""); }, [order.shipping_label_url]);
  useEffect(() => { setShipStatus(order.shipping_status || ""); }, [order.shipping_status]);
  const [savingShipping, setSavingShipping] = useState(false);
  const [shippingSaved, setShippingSaved] = useState(false);
  const [shipError, setShipError] = useState("");

  async function callFedEx(action, params) {
    setShipError("");
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error: invErr } = await base44.functions.invoke("fedexShipping", {
      action,
      accessToken: session?.access_token,
      ...params,
    });
    if (invErr) {
      setShipError(invErr.message || "FedEx request failed");
      return { error: invErr.message };
    }
    if (data?.error) setShipError(data.error);
    return data;
  }

  async function handleGetRates() {
    setLoadingRates(true);
    setShipRates([]);
    const data = await callFedEx("getRates", {
      shipTo: { street: shipStreet, city: shipCity, state: shipState, zip: shipZip, country: shipCountry },
      weight: shipWeight, length: shipLength, width: shipWidth, height: shipHeight,
    });
    if (data.rates) setShipRates(data.rates);
    setLoadingRates(false);
  }

  async function handleCreateLabel() {
    if (!shipService) { setShipError("Select a shipping service first"); return; }
    setCreatingLabel(true);
    const data = await callFedEx("createShipment", {
      shipTo: {
        street: shipStreet, city: shipCity, state: shipState, zip: shipZip, country: shipCountry,
        name: order.customer_name, company: "",
      },
      weight: shipWeight, length: shipLength, width: shipWidth, height: shipHeight,
      serviceType: shipService,
      orderId: order.id,
      customerName: order.customer_name,
    });
    if (data.trackingNumber) {
      setShipTracking(data.trackingNumber);
      setShipLabelUrl(data.labelUrl || "");
      setShipStatus("Label Created");
      // Also open the label for immediate printing
      if (data.encodedLabel) {
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(`<iframe src="${data.encodedLabel}" style="width:100%;height:100%;border:none"></iframe>`);
        }
      }
    }
    setCreatingLabel(false);
  }

  async function handleSaveShipping() {
    setSavingShipping(true);
    try {
      await base44.entities.Order.update(order.id, {
        shipping_address_street: shipStreet,
        shipping_address_city: shipCity,
        shipping_address_state: shipState,
        shipping_address_zip: shipZip,
        shipping_address_country: shipCountry,
        shipping_weight: parseFloat(shipWeight) || null,
        shipping_length: parseFloat(shipLength) || null,
        shipping_width: parseFloat(shipWidth) || null,
        shipping_height: parseFloat(shipHeight) || null,
        shipping_service_type: shipService,
      });
      setShippingSaved(true);
      setTimeout(() => setShippingSaved(false), 2000);
    } catch (err) {
      notify.error("Couldn't save shipping", err);
    } finally {
      setSavingShipping(false);
    }
  }

  async function handleTrackShipment() {
    if (!shipTracking) return;
    const data = await callFedEx("trackShipment", { trackingNumber: shipTracking });
    if (data.status) setShipStatus(data.status);
  }

  return {
    showShipping, setShowShipping,
    shipStreet, setShipStreet,
    shipCity, setShipCity,
    shipState, setShipState,
    shipZip, setShipZip,
    shipCountry, setShipCountry,
    shipWeight, setShipWeight,
    shipLength, setShipLength,
    shipWidth, setShipWidth,
    shipHeight, setShipHeight,
    shipService, setShipService,
    shipRates,
    loadingRates,
    creatingLabel,
    shipTracking,
    shipLabelUrl,
    shipStatus,
    savingShipping,
    shippingSaved,
    shipError,
    handleGetRates,
    handleCreateLabel,
    handleSaveShipping,
    handleTrackShipment,
  };
}
