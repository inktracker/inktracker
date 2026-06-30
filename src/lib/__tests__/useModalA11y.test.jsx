// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { useModalA11y } from "../useModalA11y";

afterEach(cleanup);

function Harness({ onClose, active = true, canDismiss = true }) {
  const ref = useRef(null);
  const { onKeyDown } = useModalA11y(ref, { onClose, active, canDismiss });
  return (
    <div onKeyDown={onKeyDown} data-testid="overlay">
      <div ref={ref} role="dialog" tabIndex={-1}>
        <button>First</button>
        <button>Last</button>
      </div>
    </div>
  );
}

describe("useModalA11y (FE-01 follow-up)", () => {
  it("moves focus to the first focusable when active", () => {
    render(<Harness onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("does no focus management when inactive", () => {
    const prev = document.createElement("button");
    document.body.appendChild(prev);
    prev.focus();
    render(<Harness onClose={() => {}} active={false} />);
    expect(document.activeElement).toBe(prev);
    prev.remove();
  });

  it("Escape calls onClose when canDismiss", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("overlay"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does not close when canDismiss is false", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} canDismiss={false} />);
    fireEvent.keyDown(screen.getByTestId("overlay"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab from last back to first", () => {
    render(<Harness onClose={() => {}} />);
    screen.getByText("Last").focus();
    fireEvent.keyDown(screen.getByTestId("overlay"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("traps Shift+Tab from first back to last", () => {
    render(<Harness onClose={() => {}} />);
    screen.getByText("First").focus();
    fireEvent.keyDown(screen.getByTestId("overlay"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Last"));
  });
});
