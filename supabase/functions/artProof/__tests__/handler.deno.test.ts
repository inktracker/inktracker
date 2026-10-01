// End-to-end tests for the artwork-proof flow: the REAL artProof handler and
// the REAL customer handlers (createCheckoutSession approve / request
// changes) against the in-memory fake DB. Run: `npm run test:edge`.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../../_shared/testing/fakeSupabase.ts";
import { handle, sendReminders, proofRecipient, type Deps } from "../index.ts";
import { artApprovalState, artFingerprint } from "../../_shared/artApproval.js";

// createCheckoutSession starts a server on import; stub it like its own tests.
const realServe = Deno.serve;
(Deno as unknown as { serve: unknown }).serve = () => ({});
const { handleApproveArtwork, handleRequestArtChanges } = await import("../../createCheckoutSession/index.ts");
(Deno as unknown as { serve: unknown }).serve = realServe;

const OWNER = "joe@biotamfg.co";
const ORDER_ID = "11111111-2222-4333-8444-555555555555";

function db(orderOver: Record<string, unknown> = {}) {
  return fakeSupabase({
    profiles: [
      { id: "own", auth_id: "own-auth", email: OWNER, role: "shop", shop_owner: null, shop_name: "Biota Mfg", full_name: "Joe Grennan" },
      { id: "mgr", auth_id: "mgr-auth", email: "mgr@biota.co", role: "manager", shop_owner: OWNER, full_name: "Mo Manager" },
      { id: "emp", auth_id: "emp-auth", email: "emp@biota.co", role: "employee", shop_owner: OWNER, full_name: "Em Ployee" },
      { id: "brk", auth_id: "brk-auth", email: "broker@x.com", role: "broker", assigned_shops: [OWNER] },
      { id: "other", auth_id: "other-auth", email: "other@shop.com", role: "shop" },
    ],
    profile_secrets: [],
    orders: [{
      id: ORDER_ID, order_id: "ORD-2026-0042", shop_owner: OWNER, job_title: "Fall tees", status: "Art Approval",
      customer_name: "Tahoe Gift Co", customer_email: "buyer@tahoegift.com", public_token: "tok",
      selected_artwork: [{ id: "a1", name: "Front.pdf", url: "https://x/front.pdf" }],
      line_items: [{ imprints: [{ location: "Front", colors: 2 }] }],
      ...orderOver,
    }],
    art_proofs: [],
    notifications: [],
    shops: [{ owner_email: OWNER, shop_name: "Biota Mfg" }],
  }, { rpcs: { check_request_rate: () => true } });
}

function deps(fake: any, sent: any[], env: Record<string, string> = {}): Deps {
  return {
    admin: fake,
    getUser: (t) => Promise.resolve(t === "none" ? null : { id: t }),
    env: (k) => ({ CRON_SECRET: "cron-secret", ...env } as Record<string, string>)[k],
    send: (_a, payload) => { sent.push(payload); return Promise.resolve({ ok: true }); },
    now: () => new Date("2026-10-02T17:00:00Z"),
  };
}

const req = (body: unknown, bearer = "") => new Request("http://x", { method: "POST", headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, body: JSON.stringify(body) });
const as = (authId: string, body: Record<string, unknown>) => req({ ...body, accessToken: authId });
const META = { ip: "1.2.3.4", userAgent: "Safari" };
// What the customer's page shows (and sends back): the current art + version.
const seen = (fake: any) => ({ fingerprint: artFingerprint(fake.tables.orders[0]), version: fake.tables.orders[0].art_proof_version });

Deno.test("send → v1 recorded, order waiting, customer emailed with the approval link", async () => {
  const fake = db();
  const sent: any[] = [];
  const r = await handle(as("emp-auth", { action: "send", orderId: ORDER_ID, message: "Check the colors" }), deps(fake, sent));
  const j = await r.json();
  assertEquals(j.version, 1);
  assertEquals(fake.tables.art_proofs[0].status, "sent");
  assertEquals(fake.tables.art_proofs[0].sent_by, "Em Ployee");
  assertEquals(fake.tables.orders[0].art_status, "sent");
  assertEquals(sent[0].to, "buyer@tahoegift.com");
  assertEquals(sent[0].event_type, "art_proof_sent");
  assertEquals(sent[0].reply_to, OWNER);
  assert(String(sent[0].html).includes(`ArtApproval?id=${ORDER_ID}&amp;token=tok`) || String(sent[0].html).includes(`ArtApproval?id=${ORDER_ID}&token=tok`));
  assert(String(sent[0].html).includes("Check the colors"));
});

Deno.test("customer approves → proof + order record who/when/where/what; shop bell", async () => {
  const fake = db();
  await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(fake, []));
  const res: any = await handleApproveArtwork(ORDER_ID, "Jane Smith", "tok", META, fake, seen(fake));
  assertEquals(res.order.art_state.approved, true);
  assertEquals(res.order.art_approved_fingerprint, undefined); // never sent to the customer
  const p = fake.tables.art_proofs[0];
  assertEquals([p.status, p.approved_by_name, p.client_ip, p.client_user_agent], ["approved", "Jane Smith", "1.2.3.4", "Safari"]);
  assert(artApprovalState(fake.tables.orders[0]).approved);
  assert(fake.tables.notifications.some((n) => n.event_type === "artwork_approved"));
});

Deno.test("replayed approval doesn't restamp; an approval the art outgrew can be given again", async () => {
  const fake = db();
  await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(fake, []));
  await handleApproveArtwork(ORDER_ID, "Jane", "tok", META, fake, seen(fake));
  const at = fake.tables.orders[0].art_approved_at;
  await handleApproveArtwork(ORDER_ID, "Someone else", "tok", META, fake, seen(fake));
  assertEquals(fake.tables.orders[0].art_approved_by, "Jane");
  assertEquals(fake.tables.orders[0].art_approved_at, at);
  // Shop swaps the file → approval no longer applies
  fake.tables.orders[0].selected_artwork = [{ id: "a1", name: "Front v2.pdf", url: "https://x/front-v2.pdf" }];
  assertEquals(artApprovalState(fake.tables.orders[0]).approved, false);
});

Deno.test("customer requests changes → recorded, approval cleared, shop alerted; revision is v2", async () => {
  const fake = db();
  const sent: any[] = [];
  await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(fake, sent));
  const res: any = await handleRequestArtChanges(ORDER_ID, { comment: "Logo bigger please", location: "Front", name: "Jane", ...seen(fake) }, "tok", META, fake);
  assertEquals(res.changesRequested, true);
  assertEquals(fake.tables.orders[0].art_status, "changes_requested");
  assertEquals(fake.tables.art_proofs[0].response_comment, "Logo bigger please");
  assert(fake.tables.notifications.some((n) => n.event_type === "artwork_changes_requested" && String(n.body).includes("Logo bigger please")));
  await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(fake, sent));
  assertEquals(fake.tables.art_proofs.map((p: any) => [p.version, p.status]), [[1, "superseded"], [2, "sent"]]);
});

Deno.test("customer actions need the token; change request needs a comment", async () => {
  const fake = db();
  assertEquals(((await handleApproveArtwork(ORDER_ID, "x", "bad", META, fake)) as any).error, "Order not found.");
  assertEquals(((await handleRequestArtChanges(ORDER_ID, { comment: "x" }, "bad", META, fake)) as any).error, "Order not found.");
  assert(((await handleRequestArtChanges(ORDER_ID, { comment: " " }, "tok", META, fake)) as any).error.includes("what you'd like changed"));
  assertEquals(fake.tables.art_proofs.length, 0);
});

Deno.test("override: owner/manager with a note; employees and missing notes refused", async () => {
  const fake = db();
  assertEquals((await handle(as("emp-auth", { action: "override", orderId: ORDER_ID, note: "phone" }), deps(fake, []))).status, 403);
  assertEquals((await handle(as("mgr-auth", { action: "override", orderId: ORDER_ID, note: "" }), deps(fake, []))).status, 400);
  const r = await handle(as("mgr-auth", { action: "override", orderId: ORDER_ID, note: "Approved by phone 10/2" }), deps(fake, []));
  assertEquals(r.status, 200);
  assertEquals(fake.tables.art_proofs[0].status, "approved_override");
  assertEquals(fake.tables.art_proofs[0].override_by, "Mo Manager");
  // The customer's page never shows the staff name or the internal note.
  assertEquals(fake.tables.orders[0].art_approved_by, "The shop, on your behalf");
  assert(artApprovalState(fake.tables.orders[0]).approved);
});

Deno.test("tenancy: brokers refused; another shop's order is 'not found'; no session → 401", async () => {
  const fake = db();
  assertEquals((await handle(as("brk-auth", { action: "send", orderId: ORDER_ID }), deps(fake, []))).status, 403);
  assertEquals((await handle(as("other-auth", { action: "send", orderId: ORDER_ID }), deps(fake, []))).status, 404);
  assertEquals((await handle(req({ action: "send", orderId: ORDER_ID }), deps(fake, []))).status, 401);
});

Deno.test("send refuses with no customer email or no artwork", async () => {
  const noEmail = db({ customer_email: "" });
  const r = await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(noEmail, []));
  assert((await r.json()).error.includes("customer's email"));
  const typed = await handle(as("own-auth", { action: "send", orderId: ORDER_ID, to: "other@buyer.com" }), deps(noEmail, []));
  assertEquals((await typed.json()).sentTo, "other@buyer.com");
  const noArt = db({ selected_artwork: [], line_items: [] });
  assert((await (await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(noArt, []))).json()).error.includes("Add artwork"));
});

Deno.test("broker orders: the proof goes to the broker", () => {
  assertEquals(proofRecipient({ broker_id: "broker@x.com", customer_email: "end@client.com" }), { to: "broker@x.com", role: "broker" });
});

Deno.test("reminders: once, after 2 days, only for the proof still waited on; cron secret required", async () => {
  const fake = db({ art_status: "sent", art_proof_version: 1 });
  fake.tables.art_proofs.push({ id: "p1", order_id: ORDER_ID, version: 1, status: "sent", sent_at: "2026-09-29T17:00:00Z", sent_to: "buyer@tahoegift.com", reminder_sent_at: null, shop_owner: OWNER });
  const sent: any[] = [];
  assertEquals((await handle(req({ action: "remind" }, "wrong"), deps(fake, sent))).status, 401);
  const r = await handle(req({ action: "remind" }, "cron-secret"), deps(fake, sent));
  assertEquals((await r.json()).reminded, 1);
  assertEquals(sent[0].event_type, "art_proof_reminder");
  assert(String(sent[0].subject).startsWith("Reminder:"));
  assertEquals((await sendReminders(deps(fake, sent))).reminded, 0); // only once
});

Deno.test("stale page: art changed or a newer version went out → refused, nothing written", async () => {
  const fake = db();
  await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(fake, []));
  const old = seen(fake);
  fake.tables.orders[0].selected_artwork = [{ id: "a1", name: "Front v2.pdf", url: "https://x/front-v2.pdf" }];
  const res: any = await handleApproveArtwork(ORDER_ID, "Jane", "tok", META, fake, old);
  assertEquals(res.stale, true);
  assert(res.order, "returns the fresh order so the page can reload");
  assertEquals(fake.tables.orders[0].art_status, "sent");
  assertEquals(fake.tables.art_proofs[0].status, "sent");
  const ch: any = await handleRequestArtChanges(ORDER_ID, { comment: "x", ...old }, "tok", META, fake);
  assertEquals(ch.stale, true);
  // Version moved on (v2 sent) → the v1 page can't answer either
  await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(fake, []));
  const v1: any = await handleApproveArtwork(ORDER_ID, "Jane", "tok", META, fake, { fingerprint: artFingerprint(fake.tables.orders[0]), version: 1 });
  assertEquals(v1.stale, true);
});

Deno.test("reminders skip proofs nobody is waiting on (order moved on / newer version) and dequeue them", async () => {
  const fake = db({ status: "Printing", art_status: "sent", art_proof_version: 1 });
  fake.tables.art_proofs.push({ id: "p1", order_id: ORDER_ID, version: 1, status: "sent", sent_at: "2026-09-29T17:00:00Z", sent_to: "buyer@tahoegift.com", reminder_sent_at: null, shop_owner: OWNER });
  const sent: any[] = [];
  const r = await sendReminders(deps(fake, sent));
  assertEquals(r.reminded, 0);
  assertEquals(sent.length, 0);
  assert(fake.tables.art_proofs[0].reminder_sent_at, "dequeued so it isn't re-checked every day");
});

Deno.test("send after a quote-carried approval is v2, not a second v1", async () => {
  const fake = db({ art_status: "approved", art_proof_version: 1, art_approved: true });
  const j = await (await handle(as("own-auth", { action: "send", orderId: ORDER_ID }), deps(fake, []))).json();
  assertEquals(j.version, 2);
});
