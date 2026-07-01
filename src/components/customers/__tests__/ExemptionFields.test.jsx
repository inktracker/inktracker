// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Heavy @/ dep loaded at import — talks to Supabase storage.
vi.mock("@/lib/tax/certificateStorage", () => ({
  uploadCertificate: () => Promise.resolve({ path: "" }),
  signCertificateUrl: () => Promise.resolve(null),
}));

import ExemptionFields from "../ExemptionFields";

describe("ExemptionFields", () => {
  it("mounts and shows the certificate header", () => {
    render(<ExemptionFields value={{}} onChange={() => {}} />);
    expect(screen.getByText("Exemption Certificate")).toBeTruthy();
  });
});
