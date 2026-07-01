// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import DetailsStep from "../DetailsStep";

const CONTACT = { name:"", email:"", phone:"", company:"", notes:"", dueDate:"", taxExempt:false, taxId:"" };

describe("DetailsStep", () => {
  it("renders the contact form fields", () => {
    render(<DetailsStep bc="#0d9488" contact={CONTACT} setContact={vi.fn()} setStep={vi.fn()} />);
    expect(screen.getByText("Your details")).toBeTruthy();
    expect(screen.getByText("Full Name *")).toBeTruthy();
    expect(screen.getByText("Email *")).toBeTruthy();
    expect(screen.getByText("Review Order →")).toBeTruthy();
  });
});
