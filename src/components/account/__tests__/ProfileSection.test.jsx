// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// PressesSection (rendered inside ProfileSection) hits supabase on mount.
vi.mock("@/api/supabaseClient", () => ({
  base44: {},
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
    auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) },
  },
}));

import ProfileSection from "../ProfileSection";

const noop = () => {};

const PROPS = {
  user: { email: "shop@example.com" },
  firstName: "Joe", setFirstName: noop,
  lastName: "Smith", setLastName: noop,
  shopName: "Acme Prints", setShopName: noop,
  phone: "", setPhone: noop,
  taxRate: "", setTaxRate: noop,
  timezone: "", setTimezone: noop,
  address: "", setAddress: noop,
  city: "", setCity: noop,
  stateVal: "", setStateVal: noop,
  zip: "", setZip: noop,
  website: "", setWebsite: noop,
  logoUrl: "",
  brandColor: "", setBrandColor: noop,
  uploading: false,
  saving: false,
  message: "",
  handleSave: noop,
  handleLogoUpload: noop,
  handleRemoveLogo: noop,
};

describe("ProfileSection", () => {
  it("renders the shop-profile form fields", () => {
    render(<ProfileSection {...PROPS} />);
    expect(screen.getByText("First Name")).toBeTruthy();
    expect(screen.getByText("Shop Name")).toBeTruthy();
    expect(screen.getByText("Brand Color")).toBeTruthy();
    expect(screen.getByText("Save Changes")).toBeTruthy();
    expect(screen.getByDisplayValue("Acme Prints")).toBeTruthy();
  });
});
