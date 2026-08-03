import { describe, it, expect } from "vitest";
import { buildWelcomeEmail } from "../welcomeEmail.ts";

describe("buildWelcomeEmail", () => {
  it("greets by shop name when known, generically otherwise", () => {
    expect(buildWelcomeEmail({ email: "a@b.co", shopName: "Truman Embroidery" }).html)
      .toContain("Welcome, Truman Embroidery!");
    expect(buildWelcomeEmail({ email: "a@b.co" }).html)
      .toContain("Welcome to InkTracker!");
    expect(buildWelcomeEmail({ email: "a@b.co", shopName: "   " }).html)
      .toContain("Welcome to InkTracker!");
  });

  it("escapes HTML in the shop name (it's user input)", () => {
    const html = buildWelcomeEmail({ email: "a@b.co", shopName: '<img src=x onerror=alert(1)>' }).html;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("carries the trial framing, the three steps, and the app CTA", () => {
    const { subject, html } = buildWelcomeEmail({ email: "a@b.co", shopName: "X" });
    expect(subject).toContain("trial is live");
    expect(html).toContain("14-day free trial");
    expect(html).toContain("Set your pricing");
    expect(html).toContain("Send your first quote");
    expect(html).toContain("Connect QuickBooks");
    expect(html).toContain('https://www.inktracker.app');
    // The reply-goes-to-a-human promise — reply_to is set by the caller,
    // but the copy must make the offer or nobody replies.
    expect(html).toContain("Reply to this email");
  });

  it("footer names the signup address so forwards are self-explaining", () => {
    expect(buildWelcomeEmail({ email: "new@shop.com" }).html).toContain("new@shop.com");
  });

  it("renders a full standalone HTML document (email-client safe)", () => {
    const { html } = buildWelcomeEmail({ email: "a@b.co" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("x-apple-disable-message-reformatting");
  });
});
