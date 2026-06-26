import { describe, it, expect, vi } from "vitest";
import { mintPaymentLink } from "../qbPaymentLink.js";

const extractLink = (inv) => inv?.link ?? null;
const noSleep = () => Promise.resolve();
const base = (over = {}) => ({
  initialInvoice: {},
  billEmail: "cust@example.com",
  extractLink,
  fetchLink: vi.fn(async () => null),
  sendInvoice: vi.fn(async () => null),
  sleep: noSleep,
  ...over,
});

describe("mintPaymentLink", () => {
  it("uses the link already on the create response — no fetch, no email", async () => {
    const deps = base({ initialInvoice: { link: "L0" } });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: "L0", reason: null, emailed: false });
    expect(deps.fetchLink).not.toHaveBeenCalled();
    expect(deps.sendInvoice).not.toHaveBeenCalled();
  });

  it("mints via include=invoiceLink WITHOUT calling /send (no QB email) — the whole point", async () => {
    const deps = base({ fetchLink: vi.fn(async () => ({ link: "L1" })) });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: "L1", reason: null, emailed: false });
    expect(deps.sendInvoice).not.toHaveBeenCalled(); // <- never emails on the happy path
  });

  it("retries the no-email fetch before giving up on it", async () => {
    const fetchLink = vi.fn()
      .mockResolvedValueOnce(null)         // first try: not provisioned yet
      .mockResolvedValueOnce({ link: "L2" }); // retry: link is ready
    const deps = base({ fetchLink });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: "L2", emailed: false });
    expect(fetchLink).toHaveBeenCalledTimes(2);
    expect(deps.sendInvoice).not.toHaveBeenCalled();
  });

  it("falls back to /send (emails) only when the no-email path yields nothing", async () => {
    const deps = base({
      fetchLink: vi.fn(async () => null),          // include never returns a link
      sendInvoice: vi.fn(async () => ({ link: "L3" })),
    });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: "L3", reason: null, emailed: true });
    expect(deps.sendInvoice).toHaveBeenCalledTimes(1);
    expect(deps.sendInvoice).toHaveBeenCalledWith("cust@example.com");
  });

  it("does NOT email (or even attempt /send) when there's no billEmail", async () => {
    const deps = base({ billEmail: "", fetchLink: vi.fn(async () => null) });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: null, reason: "no_bill_email", emailed: false });
    expect(deps.sendInvoice).not.toHaveBeenCalled();
  });

  it("recovers via a post-/send refetch when /send itself returns no link", async () => {
    // include: null, null; send: returns invoice w/o link; refetch: link ready.
    const fetchLink = vi.fn()
      .mockResolvedValueOnce(null)   // include try 1
      .mockResolvedValueOnce(null)   // include try 2
      .mockResolvedValueOnce({ link: "L4" }); // post-send refetch
    const deps = base({ fetchLink, sendInvoice: vi.fn(async () => ({})) });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: "L4", reason: null, emailed: true });
  });

  it("survives a throwing /send and still recovers via refetch", async () => {
    const fetchLink = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ link: "L5" });
    const deps = base({ fetchLink, sendInvoice: vi.fn(async () => { throw new Error("500"); }) });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: "L5", emailed: true });
  });

  it("reports no_link_after_retry when nothing yields a link", async () => {
    const deps = base({ fetchLink: vi.fn(async () => null), sendInvoice: vi.fn(async () => ({})) });
    const out = await mintPaymentLink(deps);
    expect(out).toMatchObject({ link: null, reason: "no_link_after_retry" });
  });
});
