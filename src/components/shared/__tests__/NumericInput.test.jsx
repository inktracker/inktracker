// @vitest-environment jsdom
// Smoke tests for the NumericInput React shell.
//
// The pure decision logic lives in numericInputState.js and is covered
// by 22 node-only tests. This file mounts the actual React component
// in jsdom to verify the integration: keystroke → decision → setState
// → re-render → focus/blur behavior. It catches the bugs that pure
// tests can't (useEffect timing, controlled-input warnings, blur snap-
// back, missing onChange propagation).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NumericInput from "../NumericInput.jsx";

function setup(props = {}) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const utils = render(
    <NumericInput
      value={props.value}
      onChange={onChange}
      onClear={onClear}
      data-testid="ni"
      {...props}
    />,
  );
  const input = utils.getByTestId("ni");
  return { input, onChange, onClear, ...utils };
}

describe("NumericInput — initial render", () => {
  it("NI1 — number value renders as its string form", () => {
    const { input } = setup({ value: 5.25 });
    expect(input.value).toBe("5.25");
  });

  it("NI2 — null/undefined value renders as empty string (no controlled-input warning)", () => {
    const { input } = setup({ value: null });
    expect(input.value).toBe("");
  });

  it("NI3 — NaN value renders as empty (don't pollute field with 'NaN')", () => {
    const { input } = setup({ value: NaN });
    expect(input.value).toBe("");
  });

  it("NI4 — input is type=text with decimal inputmode (not type=number)", () => {
    // type=number causes browser auto-formatting that swallows '5.'
    // and accepts scientific notation. Keep full control by using
    // text + inputmode for the mobile numeric keyboard.
    const { input } = setup({ value: 5 });
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("decimal");
  });

  it("NI5 — integer flag sets inputmode=numeric", () => {
    const { input } = setup({ value: 5, integer: true });
    expect(input.inputMode).toBe("numeric");
  });
});

describe("NumericInput — propagates clean numbers", () => {
  it("NI6 — typing a clean number fires onChange with the parsed value", () => {
    const { input, onChange } = setup({ value: 0 });
    fireEvent.change(input, { target: { value: "5.25" } });
    expect(onChange).toHaveBeenCalledWith(5.25);
  });

  it("NI7 — onChange is NOT called when input would parse to garbage", () => {
    const { input, onChange } = setup({ value: 0 });
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("NI8 — onChange is NOT called for empty (clearOnEmpty defaults false)", () => {
    // The bug this prevents: user clears the field momentarily while
    // retyping, parent's saved value gets clobbered to 0.
    const { input, onChange } = setup({ value: 7 });
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("NI9 — onChange is NOT called when value is out of range", () => {
    const { input, onChange } = setup({ value: 50, min: 0, max: 100 });
    fireEvent.change(input, { target: { value: "150" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("NI10 — onChange is NOT called for scientific notation (would otherwise be 50000000000)", () => {
    const { input, onChange } = setup({ value: 5 });
    fireEvent.change(input, { target: { value: "5e10" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NumericInput — visual error state", () => {
  it("NI11 — invalid input adds error border class", () => {
    const { input } = setup({ value: 0, className: "base-class" });
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.className).toMatch(/border-red-400/);
    expect(input.className).toMatch(/base-class/); // original class preserved
  });

  it("NI12 — invalid input sets aria-invalid", () => {
    const { input } = setup({ value: 0 });
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("NI13 — valid input clears the error border", () => {
    const { input } = setup({ value: 0 });
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.className).toMatch(/border-red-400/);
    fireEvent.change(input, { target: { value: "5" } });
    expect(input.className).not.toMatch(/border-red-400/);
  });

  it("NI14 — empty (intermediate) input does NOT show error border", () => {
    // Empty mid-edit is a normal state, not a user error.
    const { input } = setup({ value: 5 });
    fireEvent.change(input, { target: { value: "" } });
    expect(input.className).not.toMatch(/border-red-400/);
  });
});

describe("NumericInput — blur snapback", () => {
  it("NI15 — empty + blur snaps display back to the saved value", () => {
    // The cell-cant-be-silently-zeroed guarantee: if user clears and
    // walks away, the field shows what's actually persisted.
    const { input } = setup({ value: 7 });
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe(""); // intermediate
    fireEvent.blur(input);
    expect(input.value).toBe("7"); // snapped back
  });

  it("NI16 — invalid + blur preserves the bad text so user can see what to fix", () => {
    // Don't yank the invalid text out on blur — they need to see and fix it.
    const { input } = setup({ value: 7 });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(input.value).toBe("abc");
    expect(input.className).toMatch(/border-red-400/);
  });

  it("NI17 — clearOnEmpty=true + blur leaves empty (intentional clear)", () => {
    const { input } = setup({ value: 7, clearOnEmpty: true });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("");
  });
});

describe("NumericInput — clearOnEmpty mode (for fields like clientPpp)", () => {
  it("NI18 — clearOnEmpty=true fires onClear when emptied", () => {
    const { input, onClear } = setup({ value: 7, clearOnEmpty: true });
    fireEvent.change(input, { target: { value: "" } });
    expect(onClear).toHaveBeenCalled();
  });

  it("NI19 — clearOnEmpty=false does NOT fire onClear", () => {
    const { input, onClear } = setup({ value: 7, clearOnEmpty: false });
    fireEvent.change(input, { target: { value: "" } });
    expect(onClear).not.toHaveBeenCalled();
  });
});

describe("NumericInput — external value sync", () => {
  it("NI20 — value prop change while NOT focused updates display", () => {
    const { input, rerender } = setup({ value: 5 });
    expect(input.value).toBe("5");
    // Not focused — value changes externally (e.g. DB load, sibling update)
    rerender(
      <NumericInput value={10} data-testid="ni" onChange={() => {}} />,
    );
    expect(input.value).toBe("10");
  });

  it("NI21 — value prop change while focused does NOT clobber active typing", () => {
    // Hostile UX: user mid-type, external state update yanks their text.
    // The component's useEffect checks document.activeElement and skips
    // sync when the field has focus.
    const { input, rerender } = setup({ value: 5 });
    input.focus();
    fireEvent.change(input, { target: { value: "1.2" } });
    expect(input.value).toBe("1.2");

    // External update fires (e.g. parent re-renders).
    rerender(
      <NumericInput value={99} data-testid="ni" onChange={() => {}} />,
    );

    // Display still reflects what user typed, not the new prop value.
    expect(input.value).toBe("1.2");
  });
});

describe("NumericInput — integer flag", () => {
  it("NI22 — decimal input rejected when integer=true", () => {
    const { input, onChange } = setup({ value: 5, integer: true });
    fireEvent.change(input, { target: { value: "5.5" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.className).toMatch(/border-red-400/);
  });

  it("NI23 — integer input accepted when integer=true", () => {
    const { input, onChange } = setup({ value: 5, integer: true });
    fireEvent.change(input, { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
