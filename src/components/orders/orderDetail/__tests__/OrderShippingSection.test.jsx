// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import OrderShippingSection from "../OrderShippingSection";

const noop = () => {};

const PROPS = {
  showShipping: true,
  setShowShipping: noop,
  shipError: "",
  shipTracking: "",
  shipStatus: "",
  shipLabelUrl: "",
  shipStreet: "", setShipStreet: noop,
  shipCity: "", setShipCity: noop,
  shipState: "", setShipState: noop,
  shipZip: "", setShipZip: noop,
  shipCountry: "US", setShipCountry: noop,
  shipWeight: "", setShipWeight: noop,
  shipLength: "", setShipLength: noop,
  shipWidth: "", setShipWidth: noop,
  shipHeight: "", setShipHeight: noop,
  shipService: "", setShipService: noop,
  shipRates: [],
  loadingRates: false,
  creatingLabel: false,
  savingShipping: false,
  shippingSaved: false,
  handleGetRates: noop,
  handleSaveShipping: noop,
  handleCreateLabel: noop,
  handleTrackShipment: noop,
};

describe("OrderShippingSection", () => {
  it("renders the shipping form when expanded", () => {
    render(<OrderShippingSection {...PROPS} />);
    expect(screen.getByText("Ship To")).toBeTruthy();
    expect(screen.getByPlaceholderText("Street address")).toBeTruthy();
    expect(screen.getByText("Get Rates")).toBeTruthy();
  });
});
