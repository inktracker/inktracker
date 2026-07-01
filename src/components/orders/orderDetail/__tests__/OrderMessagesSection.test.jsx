// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// MessagesTab loads the supabase client at import; stub it so the section
// mounts without a live backend.
vi.mock("../../../shared/MessagesTab", () => ({
  default: () => <div>messages-tab</div>,
}));

import OrderMessagesSection from "../OrderMessagesSection";

describe("OrderMessagesSection", () => {
  it("renders the Messages section with the order + quote threads", () => {
    render(
      <OrderMessagesSection
        order={{ order_id: "ORD-2026-001", quote_id: "Q-2026-001", shop_owner: "shop@x.com", customer_email: "c@x.com" }}
        shopName="Ink Shop"
      />
    );
    expect(screen.getByText("Messages")).toBeTruthy();
    expect(screen.getByText(/From originating quote Q-2026-001/)).toBeTruthy();
    expect(screen.getAllByText("messages-tab").length).toBe(2);
  });
});
