// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Heavy @/ dep loaded at import — Supabase client.
vi.mock("@/api/supabaseClient", () => ({
  base44: { functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) } },
  supabase: { auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) } },
}));

import MergeDuplicatesModal from "../MergeDuplicatesModal";

describe("MergeDuplicatesModal", () => {
  it("mounts and shows the Customer Duplicates heading", () => {
    render(
      <MergeDuplicatesModal
        customers={[]}
        user={null}
        onMerge={() => {}}
        onClose={() => {}}
        supabaseFuncUrl=""
      />
    );
    expect(screen.getByText("Customer Duplicates")).toBeTruthy();
    expect(screen.getByText("No duplicates detected.")).toBeTruthy();
  });
});
