// Vitest setup: auto-cleanup React Testing Library after each test.
//
// Without this, render() leaves DOM nodes between tests and getByTestId
// throws "found multiple elements." We don't want to enable Vitest's
// `globals: true` (would mask explicit imports), so we register the
// hook manually.

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
