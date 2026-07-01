// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Heavy @/ deps loaded at import.
vi.mock("@/lib/uploadFile", () => ({ openSignedArtwork: () => {} }));
vi.mock("@/lib/tax/certificateStorage", () => ({
  uploadCertificate: () => Promise.resolve({ path: "" }),
  signCertificateUrl: () => Promise.resolve(null),
}));

import EditCustomerModal from "../EditCustomerModal";

const EDITING = {
  id: "c1", name: "Jane Smith", company: "Acme Co", email: "", phone: "",
  notes: "", tax_id: "", bill_to_address: null, ship_to_address: null,
  tax_exempt: false, default_deposit_pct: 0, saved_imprints: [],
};

describe("EditCustomerModal", () => {
  it("renders the Edit Customer heading and Save button", () => {
    render(
      <EditCustomerModal
        editing={EDITING}
        setEditing={() => {}}
        confirmDelete={false}
        setConfirmDelete={() => {}}
        artworkNote=""
        setArtworkNote={() => {}}
        artworkColorCount=""
        setArtworkColorCount={() => {}}
        handleSaveEdit={() => {}}
        editSaving={false}
        editSaved={false}
        handleDelete={() => {}}
        handleArtworkUpload={() => {}}
        uploadingArtwork={false}
        currentEditingArtwork={[]}
        handleRemoveArtwork={() => {}}
      />
    );
    expect(screen.getByText("Edit Customer")).toBeTruthy();
    expect(screen.getByText("Save Changes")).toBeTruthy();
  });
});
