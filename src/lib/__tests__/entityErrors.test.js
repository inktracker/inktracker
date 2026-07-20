import { describe, it, expect } from "vitest";
import { describeEntityError, enrichEntityError } from "../entityErrors";

// PostgREST error shape: { message, details, hint, code }.
const pg = (code, message) => ({ code, message, details: null, hint: null });

describe("describeEntityError — no raw SQL reaches the user", () => {
  it("22P02 invalid input syntax for type date → format guidance (the Truman bug)", () => {
    const msg = describeEntityError(pg("22P02", 'invalid input syntax for type date: ""'));
    expect(msg).toMatch(/wrong format|check your entries/i);
    expect(msg).not.toMatch(/invalid input syntax|22P02|type date/i);
  });

  it("also catches invalid-input-syntax by message when code is absent", () => {
    const msg = describeEntityError({ message: 'invalid input syntax for type numeric: "abc"' });
    expect(msg).toMatch(/wrong format/i);
    expect(msg).not.toMatch(/invalid input syntax/i);
  });

  it("23505 unique_violation → 'already exists'", () => {
    expect(describeEntityError(pg("23505", "duplicate key value violates unique constraint"))).toMatch(/already exists/i);
  });

  it("completed-order delete guard (23514 RAISE) → clean 'kept on file' guidance, not the generic 23514 text", () => {
    // The refuse_completed_order_delete trigger raises with ERRCODE=check_violation.
    const msg = describeEntityError(pg(
      "23514",
      "Cannot delete a Completed order (order_id: abc-123, customer: Acme). Completed orders are preserved as historical records — update the status instead if you really mean it.",
    ));
    expect(msg).toMatch(/completed.*historical record|kept as a historical record|move it back/i);
    expect(msg).toMatch(/revert/i);
    // Never leak the raw internals (UUID / "order_id:") or the generic 23514 text.
    expect(msg).not.toMatch(/order_id:|abc-123|isn't allowed here/i);
  });

  it("a real check-constraint violation (23514) still maps to the generic guidance", () => {
    const msg = describeEntityError(pg("23514", 'new row for relation "quotes" violates check constraint "quotes_total_nonneg"'));
    expect(msg).toMatch(/isn't allowed here|double-check/i);
    expect(msg).not.toMatch(/quotes_total_nonneg|violates check constraint/i);
  });

  it("23502 not_null → required field missing", () => {
    expect(describeEntityError(pg("23502", "null value in column \"name\" violates not-null constraint"))).toMatch(/required field/i);
  });

  it("42501 + row-level-security → permission/session guidance", () => {
    expect(describeEntityError(pg("42501", "permission denied"))).toMatch(/permission|sign in again/i);
    expect(describeEntityError({ message: "new row violates row-level security policy for table \"quotes\"" }))
      .toMatch(/permission|sign in again/i);
  });

  it("PGRST301 JWT expired → session guidance", () => {
    expect(describeEntityError(pg("PGRST301", "JWT expired"))).toMatch(/session expired|sign in again/i);
  });

  it("undefined column (42703) is treated as our bug, not dumped at the user", () => {
    const msg = describeEntityError(pg("42703", 'column "foo" does not exist'));
    expect(msg).toMatch(/misconfigured|contact support/i);
    expect(msg).not.toMatch(/column|does not exist|42703/i);
  });

  it("network failure → connection guidance", () => {
    expect(describeEntityError({ message: "TypeError: Failed to fetch" })).toMatch(/connection|reach the server/i);
  });

  it("unmapped error → clean fallback, never the raw message", () => {
    const raw = "some gnarly internal postgres detail 0x1234";
    const msg = describeEntityError(pg("XX999", raw));
    expect(msg).not.toContain(raw);
    expect(msg).toMatch(/try again/i);
  });

  it("null → fallback", () => {
    expect(describeEntityError(null)).toBeTruthy();
  });
});

describe("enrichEntityError — friendly message, raw preserved", () => {
  it("returns an Error with the friendly message and preserves code/raw", () => {
    const original = pg("23505", "duplicate key value violates unique constraint \"customers_email\"");
    const e = enrichEntityError(original);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/already exists/i);
    expect(e.code).toBe("23505");        // preserved for logging / any branching
    expect(e.raw).toBe(original);        // raw kept for Sentry/console
  });
});
