// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Heavy @/ dep pulled in transitively via ExemptionFields.
vi.mock("@/lib/tax/certificateStorage", () => ({
  uploadCertificate: () => Promise.resolve({ path: "" }),
  signCertificateUrl: () => Promise.resolve(null),
}));

import AddCustomerForm from "../AddCustomerForm";

const FORM = {
  name: "", company: "", email: "", phone: "", notes: "", tax_id: "",
  bill_to_address: null, ship_to_address: null, tax_exempt: false,
  default_deposit_pct: 0,
};

describe("AddCustomerForm", () => {
  it("renders the New Customer heading and Add button", () => {
    render(<AddCustomerForm form={FORM} setForm={() => {}} handleAdd={() => {}} addingCustomer={false} />);
    expect(screen.getByText("New Customer")).toBeTruthy();
    expect(screen.getByText("Add Customer")).toBeTruthy();
  });
});
