// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import ModalBackdrop from "../ModalBackdrop";

afterEach(cleanup);

describe("ModalBackdrop — dialog a11y (FE-01)", () => {
  it("renders a labelled modal dialog", () => {
    render(
      <ModalBackdrop onClose={() => {}} ariaLabel="Send quote">
        <div><button>Inside</button></div>
      </ModalBackdrop>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Send quote");
  });

  it("uses aria-labelledby over aria-label when an id is given", () => {
    render(
      <ModalBackdrop onClose={() => {}} ariaLabelledby="t1" ariaLabel="ignored">
        <h2 id="t1">Title</h2>
      </ModalBackdrop>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("t1");
    expect(dialog.hasAttribute("aria-label")).toBe(false);
  });

  it("moves focus to the first focusable on open", () => {
    render(
      <ModalBackdrop onClose={() => {}}>
        <button>First</button>
      </ModalBackdrop>,
    );
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("restores focus to the opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(
      <ModalBackdrop onClose={() => {}}>
        <button>Inside</button>
      </ModalBackdrop>,
    );
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("Escape closes when backdrop-dismiss is enabled (default)", () => {
    const onClose = vi.fn();
    render(
      <ModalBackdrop onClose={onClose}>
        <button>Inside</button>
      </ModalBackdrop>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT close when dismissOnBackdropClick is false (protects unsaved edits)", () => {
    const onClose = vi.fn();
    render(
      <ModalBackdrop onClose={onClose} dismissOnBackdropClick={false}>
        <button>Inside</button>
      </ModalBackdrop>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab from the last focusable back to the first", () => {
    render(
      <ModalBackdrop onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </ModalBackdrop>,
    );
    const last = screen.getByText("Last");
    last.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("traps Shift+Tab from the first focusable back to the last", () => {
    render(
      <ModalBackdrop onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </ModalBackdrop>,
    );
    screen.getByText("First").focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("Last"));
  });
});
