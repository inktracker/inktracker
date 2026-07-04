-- ─────────────────────────────────────────────────────────────────────────
-- OUT-OF-BAND OBJECT CAPTURE (2026-07-03) — runs LAST in the chain.
-- These objects exist in production but were created in the dashboard and
-- never committed to any migration. Some (the *_manager policies) call
-- functions that mid-chain migrations create, so this capture must follow
-- the full replay. Every statement is duplicate-guarded: pushing this file
-- against the LIVE database is a no-op.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- OUT-OF-BAND OBJECTS (captured from the live DB 2026-07-03): functions,
-- RLS policies, and indexes created in the dashboard and never committed
-- to a migration. Without this section a migrations-only rebuild silently
-- DROPS 13 active tenant-isolation policies (manager role, anon-token
-- access, broker write) and the token-lookup functions the edge layer
-- calls. Captured VERBATIM from `supabase db dump` — tenancy predicates
-- are exactly what production runs, not re-authored.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."get_order_by_token"("p_token" "text") RETURNS SETOF "public"."orders"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM orders WHERE public_token = p_token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION "public"."get_quote_by_token"("p_token" "text") RETURNS SETOF "public"."quotes"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM quotes WHERE public_token = p_token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS "orders_public_token_idx" ON "public"."orders" USING "btree" ("public_token");

CREATE INDEX IF NOT EXISTS "quotes_public_token_idx" ON "public"."quotes" USING "btree" ("public_token");

DO $$ BEGIN
CREATE POLICY "customers_manager" ON "public"."customers" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Customers'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Customers'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "expenses_manager" ON "public"."expenses" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Performance'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Performance'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "inventory_items_manager" ON "public"."inventory_items" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Inventory'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Inventory'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "invoices_manager" ON "public"."invoices" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "orders_anon_select_token" ON "public"."orders" FOR SELECT TO "anon" USING ((("public_token" IS NOT NULL) AND ("public_token" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-public-token'::"text"))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "payees_manager" ON "public"."payees" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "payment_accounts_manager" ON "public"."payment_accounts" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "quotes_anon_insert_restricted" ON "public"."quotes" FOR INSERT TO "anon" WITH CHECK ((("shop_owner" IS NOT NULL) AND ("shop_owner" <> ''::"text") AND (EXISTS ( SELECT 1
   FROM "public"."shops"
  WHERE ("shops"."owner_email" = "quotes"."shop_owner")))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "quotes_anon_select_token" ON "public"."quotes" FOR SELECT TO "anon" USING ((("public_token" IS NOT NULL) AND ("public_token" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-public-token'::"text"))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "quotes_broker_write" ON "public"."quotes" TO "authenticated" USING (("broker_id" = ("auth"."jwt"() ->> 'email'::"text"))) WITH CHECK (("broker_id" = ("auth"."jwt"() ->> 'email'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "quotes_manager" ON "public"."quotes" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Quotes'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Quotes'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "shop_performance_manager" ON "public"."shop_performance" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Performance'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Performance'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
CREATE POLICY "tax_categories_manager" ON "public"."tax_categories" TO "authenticated" USING ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text"))) WITH CHECK ((("shop_owner" IN ( SELECT "jsonb_array_elements_text"("p"."assigned_shops") AS "jsonb_array_elements_text"
   FROM "public"."profiles" "p"
  WHERE (("p"."auth_id" = "auth"."uid"()) AND ("p"."assigned_shops" IS NOT NULL) AND ("p"."role" = 'manager'::"text")))) AND "public"."manager_section_allowed"('Invoices'::"text")));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Re-apply the 20260701 revokes to the functions created above — on a fresh
-- replay they didn't exist when that migration ran. Matches live privileges.
REVOKE EXECUTE ON FUNCTION public.get_quote_by_token(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_order_by_token(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
