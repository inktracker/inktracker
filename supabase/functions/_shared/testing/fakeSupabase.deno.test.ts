// Self-test for the fake client — proves the write recording + filter
// semantics the handler tests lean on actually behave like supabase-js.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "./fakeSupabase.ts";

Deno.test("update applies to filtered rows only and is recorded with its filters", async () => {
  const db = fakeSupabase({ quotes: [{ id: "a", shop_owner: "s1", total: 1 }, { id: "b", shop_owner: "s2", total: 1 }] });
  const { error } = await db.from("quotes").update({ total: 9 }).eq("id", "a").eq("shop_owner", "s1");
  assertEquals(error, null);
  assertEquals(db.tables.quotes.map((r) => r.total), [9, 1]);
  assertEquals(db.writes.length, 1);
  assertEquals(db.writes[0].op, "update");
  assertEquals(db.writes[0].filters.map((f) => `${f.col}=${f.val}`), ["id=a", "shop_owner=s1"]);
});

Deno.test("insert + select().single() returns the inserted row; is/not-is/gte filters work", async () => {
  const db = fakeSupabase({ notifications: [] });
  const { data } = await db.from("notifications").insert({ id: "n1", read_at: null, n: 5 }).select("id").single();
  assertEquals((data as { id: string }).id, "n1");
  const unread = await db.from("notifications").select("id").is("read_at", null);
  assertEquals((unread.data as unknown[]).length, 1);
  const read = await db.from("notifications").select("id").not("read_at", "is", null);
  assertEquals((read.data as unknown[]).length, 0);
  const big = await db.from("notifications").select("id").gte("n", 5);
  assertEquals((big.data as unknown[]).length, 1);
});

Deno.test("count head query resolves { count }; delete removes rows; rpc override", async () => {
  const db = fakeSupabase({ t: [{ id: 1, k: "x" }, { id: 2, k: "x" }, { id: 3, k: "y" }] }, { rpcs: { ping: () => "pong" } });
  const c = await db.from("t").select("id", { count: "exact", head: true }).eq("k", "x");
  assertEquals(c.count, 2);
  await db.from("t").delete().eq("k", "x");
  assertEquals(db.tables.t.length, 1);
  assertEquals((await db.rpc("ping")).data, "pong");
  assert((await db.rpc("other")).data === true);
});
