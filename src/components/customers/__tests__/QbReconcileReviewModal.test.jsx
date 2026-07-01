// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import QbReconcileReviewModal from "../QbReconcileReviewModal";

describe("QbReconcileReviewModal", () => {
  it("mounts and shows the Finish QuickBooks Merges heading", () => {
    render(<QbReconcileReviewModal pairs={[]} onMerge={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Finish QuickBooks Merges")).toBeTruthy();
  });
});
