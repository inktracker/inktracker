import { describe, it, expect } from "vitest";
import { buildDay2NudgeEmail, buildTrialEndingEmail } from "../dripEmails.ts";

describe("buildDay2NudgeEmail", () => {
  it("names the shop when known, stays generic otherwise", () => {
    expect(buildDay2NudgeEmail({ email: "a@b.co", shopName: "Truman Embroidery" }).html)
      .toContain("Truman Embroidery is");
    expect(buildDay2NudgeEmail({ email: "a@b.co" }).html)
      .toContain("You're");
  });

  it("escapes HTML in the shop name (it's user input)", () => {
    const html = buildDay2NudgeEmail({ email: "a@b.co", shopName: "<img src=x onerror=alert(1)>" }).html;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("carries the quote CTA and the reply-goes-to-a-human promise", () => {
    const { subject, html } = buildDay2NudgeEmail({ email: "a@b.co" });
    expect(subject).toContain("first quote");
    expect(html).toContain("https://www.inktracker.app/Quotes");
    expect(html).toContain("Reply to this email");
  });

  it("footer names the recipient so forwards are self-explaining", () => {
    expect(buildDay2NudgeEmail({ email: "new@shop.com" }).html).toContain("new@shop.com");
  });

  it("renders a full standalone HTML document (email-client safe)", () => {
    const { html } = buildDay2NudgeEmail({ email: "a@b.co" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("x-apple-disable-message-reformatting");
  });
});

describe("buildTrialEndingEmail", () => {
  it("phrases the deadline by days left", () => {
    expect(buildTrialEndingEmail({ email: "a@b.co", daysLeft: 3 }).subject)
      .toBe("Your InkTracker trial ends in 3 days");
    expect(buildTrialEndingEmail({ email: "a@b.co", daysLeft: 1 }).subject)
      .toBe("Your InkTracker trial ends tomorrow");
    expect(buildTrialEndingEmail({ email: "a@b.co", daysLeft: 0 }).subject)
      .toBe("Your InkTracker trial ends today");
    expect(buildTrialEndingEmail({ email: "a@b.co", daysLeft: 2 }).html)
      .toContain("ends in 2 days");
  });

  it("makes the honest no-pressure promise: view-only, nothing deleted, exportable", () => {
    const { html } = buildTrialEndingEmail({ email: "a@b.co", daysLeft: 3 });
    expect(html).toContain("view-only");
    expect(html).toContain("nothing is deleted");
    expect(html).toContain("exportable");
  });

  it("links the convert screen and states the flat price", () => {
    const { html } = buildTrialEndingEmail({ email: "a@b.co", daysLeft: 3 });
    expect(html).toContain("https://www.inktracker.app/Account?billing=1");
    expect(html).toContain("$99/mo");
    expect(html).toContain("$999/yr");
  });

  it("escapes HTML in the shop name (it's user input)", () => {
    const html = buildTrialEndingEmail({ email: "a@b.co", shopName: "<b>X</b>", daysLeft: 3 }).html;
    expect(html).not.toContain("<b>X</b>");
  });
});
