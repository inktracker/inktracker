-- ─────────────────────────────────────────────────────────────────────────
-- BASELINE SCHEMA (generated 2026-07-03 from the live database catalog via
-- `supabase db dump --schema public`, filtered by scripts in the
-- feat/data-durability work; see docs/disaster-recovery.md).
--
-- WHY THIS EXISTS: the original tables were created in the dashboard before
-- migrations were adopted, so the chain in this directory could NOT rebuild
-- the schema from an empty database — the very first migration assumed
-- `profiles` already existed. This file is the missing origin.
--
-- SCOPE: tables, columns, sequences, enum types, PK/UNIQUE/FK constraints
-- (except constraints that a later migration adds — those stay owned by
-- their migration). NO policies, functions, triggers, or indexes here —
-- they all replay from the later migration files.
--
-- IDEMPOTENT BY CONSTRUCTION: every statement is IF NOT EXISTS or wrapped
-- in a duplicate-tolerant DO block, so pushing this against the LIVE
-- database is a no-op. It is validated weekly by the restore drill
-- (.github/workflows/restore-drill.yml), which replays the entire chain
-- from an empty Postgres.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "text",
    "shop_owner" "text",
    "broker_id" "text",
    "customer_id" "text",
    "customer_name" "text" NOT NULL,
    "date" "date",
    "due_date" "date",
    "step_dates" "jsonb",
    "status" "text" DEFAULT 'Art Approval'::"text",
    "line_items" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "rush_rate" numeric DEFAULT 0,
    "extras" "jsonb",
    "discount" numeric DEFAULT 0,
    "tax_rate" numeric DEFAULT 8.265,
    "subtotal" numeric,
    "tax" numeric,
    "total" numeric,
    "paid" boolean DEFAULT false,
    "paid_date" "date",
    "pdf_url" "text",
    "selected_artwork" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "broker_name" "text",
    "broker_company" "text",
    "broker_client_name" "text",
    "job_title" "text",
    "ss_order_id" "text",
    "imprints" "jsonb" DEFAULT '[]'::"jsonb",
    "tax_id" "text",
    "tax_exempt" boolean DEFAULT false,
    "art_approved" boolean DEFAULT false,
    "art_approved_at" timestamp with time zone,
    "art_approved_by" "text",
    "discount_type" "text" DEFAULT 'percent'::"text",
    "actual_cost" numeric,
    "actual_labor_hours" numeric DEFAULT 0,
    "actual_labor_cost" numeric DEFAULT 0,
    "assigned_press" "text",
    "assigned_operator" "text",
    "step_notes" "jsonb" DEFAULT '{}'::"jsonb",
    "actual_step_dates" "jsonb" DEFAULT '{}'::"jsonb",
    "is_at_risk" boolean DEFAULT false,
    "risk_reason" "text",
    "checklist" "jsonb" DEFAULT '{}'::"jsonb",
    "public_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text"),
    "shipping_address_street" "text",
    "shipping_address_city" "text",
    "shipping_address_state" "text",
    "shipping_address_zip" "text",
    "shipping_address_country" "text" DEFAULT 'US'::"text",
    "shipping_weight" numeric,
    "shipping_length" numeric,
    "shipping_width" numeric,
    "shipping_height" numeric,
    "shipping_service_type" "text",
    "shipping_carrier" "text" DEFAULT 'FedEx'::"text",
    "tracking_number" "text",
    "shipping_label_url" "text",
    "shipping_rate" numeric,
    "shipping_status" "text",
    "completed_date" "date",
    "customer_email" "text",
    "quote_id" "text",
    "deposit_paid" boolean DEFAULT false,
    "setup_screens_override" integer,
    "is_reorder" boolean DEFAULT false NOT NULL,
    "setup_total" numeric DEFAULT 0 NOT NULL,
    "setup_skipped_fee_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "setup_fee_breakdown" "jsonb",
    "scheduled_date" "date",
    "estimated_hours" numeric,
    "scheduled_end_date" "date",
    "company" "text",
    "order_date" "date",
    "additional_charges" "jsonb",
    "deposit_pct" numeric,
    CONSTRAINT "orders_schedule_range_check" CHECK ((("scheduled_end_date" IS NULL) OR ("scheduled_date" IS NULL) OR ("scheduled_end_date" >= "scheduled_date"))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['Art Approval'::"text", 'Order Goods'::"text", 'Pre-Press'::"text", 'Printing'::"text", 'Completed'::"text"]))),
    CONSTRAINT "orders_subtotal_nonneg" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "orders_tax_nonneg" CHECK (("tax" >= (0)::numeric)),
    CONSTRAINT "orders_total_nonneg" CHECK (("total" >= (0)::numeric))
);

CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quote_id" "text",
    "shop_owner" "text" NOT NULL,
    "broker_id" "text",
    "broker_name" "text",
    "broker_company" "text",
    "customer_id" "text",
    "customer_name" "text" NOT NULL,
    "customer_email" "text",
    "date" "date",
    "due_date" "date",
    "status" "text" DEFAULT 'Draft'::"text",
    "notes" "text",
    "rush_rate" numeric DEFAULT 0,
    "extras" "jsonb",
    "line_items" "jsonb" DEFAULT '[]'::"jsonb",
    "discount" numeric DEFAULT 0,
    "tax_rate" numeric DEFAULT 8.265,
    "deposit_pct" numeric DEFAULT 50,
    "deposit_paid" boolean DEFAULT false,
    "sent_to" "text",
    "sent_date" timestamp with time zone,
    "client_status" "text",
    "payment_status" "text" DEFAULT 'Unpaid'::"text",
    "sent_to_client_at" timestamp with time zone,
    "client_approved_at" timestamp with time zone,
    "converted_order_id" "text",
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "qb_invoice_id" "text",
    "qb_payment_link" "text",
    "qb_synced_at" timestamp with time zone,
    "broker_email" "text",
    "imprints" "jsonb",
    "job_title" "text",
    "tax_id" "text",
    "tax_exempt" boolean DEFAULT false,
    "broker_client_name" "text",
    "subtotal" numeric DEFAULT 0,
    "tax" numeric DEFAULT 0,
    "total" numeric DEFAULT 0,
    "selected_artwork" "jsonb" DEFAULT '[]'::"jsonb",
    "expires_date" "date",
    "payment_link" "text",
    "qb_subtotal" numeric,
    "qb_tax_amount" numeric,
    "qb_total" numeric,
    "client_total_override" numeric,
    "source" "text",
    "discount_type" "text" DEFAULT 'percent'::"text",
    "phone" "text",
    "company" "text",
    "source_email_id" "text",
    "public_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text"),
    "broker_tax_rate" numeric DEFAULT 0 NOT NULL,
    "client_subtotal" numeric DEFAULT 0 NOT NULL,
    "client_tax" numeric DEFAULT 0 NOT NULL,
    "client_total" numeric DEFAULT 0 NOT NULL,
    "setup_screens_override" integer,
    "is_reorder" boolean DEFAULT false NOT NULL,
    "setup_total" numeric DEFAULT 0 NOT NULL,
    "setup_skipped_fee_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "setup_fee_breakdown" "jsonb",
    "qb_doc_number" "text",
    "possible_existing_customer_id" "uuid",
    "additional_charges" "jsonb",
    CONSTRAINT "quotes_deposit_pct_range" CHECK ((("deposit_pct" IS NULL) OR (("deposit_pct" >= (0)::numeric) AND ("deposit_pct" <= (100)::numeric)))),
    CONSTRAINT "quotes_subtotal_nonneg" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "quotes_tax_nonneg" CHECK (("tax" >= (0)::numeric)),
    CONSTRAINT "quotes_total_nonneg" CHECK (("total" >= (0)::numeric))
);

CREATE TABLE IF NOT EXISTS "public"."anon_email_rate" (
    "rate_key" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "call_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."artwork_objects" (
    "name" "text" NOT NULL,
    "shop_owner" "text" NOT NULL,
    "uploader_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."assistant_usage" (
    "user_id" "uuid" NOT NULL,
    "day" "date" DEFAULT CURRENT_DATE NOT NULL,
    "count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."broker_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text",
    "broker_id" "text",
    "name" "text",
    "file_url" "text",
    "note" "text",
    "color_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "file_type" "text"
);

CREATE TABLE IF NOT EXISTS "public"."broker_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "broker_id" "text",
    "shop_owner" "text",
    "name" "text",
    "file_url" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "order_id" "text",
    "customer_name" "text",
    "date" "date"
);

CREATE TABLE IF NOT EXISTS "public"."broker_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text",
    "broker_id" "text",
    "action" "text",
    "item_label" "text",
    "item_id" "text",
    "item_entity" "text",
    "read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "broker_name" "text",
    "broker_company" "text"
);

CREATE TABLE IF NOT EXISTS "public"."broker_performance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "broker_id" "text",
    "shop_owner" "text",
    "orders" integer DEFAULT 0,
    "revenue" numeric DEFAULT 0,
    "date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "order_id" "text",
    "customer_name" "text",
    "total" numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "public"."commissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "broker_id" "text",
    "broker_name" "text",
    "shop_owner" "text" NOT NULL,
    "order_id" "text",
    "customer_name" "text",
    "order_total" numeric,
    "commission_pct" numeric,
    "commission_amount" numeric,
    "status" "text" DEFAULT 'Pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "paid_date" "date",
    CONSTRAINT "commissions_commission_amount_nonneg" CHECK (("commission_amount" >= (0)::numeric)),
    CONSTRAINT "commissions_order_total_nonneg" CHECK (("order_total" >= (0)::numeric))
);

CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "name" "text" NOT NULL,
    "company" "text",
    "email" "text",
    "phone" "text",
    "address" "text",
    "notes" "text",
    "orders" integer DEFAULT 0,
    "tax_id" "text",
    "tax_exempt" boolean DEFAULT false,
    "saved_imprints" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "qb_customer_id" "text",
    "default_deposit_pct" numeric DEFAULT 0,
    "ship_to_address" "jsonb",
    "exemption_type" "text",
    "exemption_certificate_number" "text",
    "exemption_certificate_path" "text",
    "exemption_expires_at" "date",
    "exemption_states" "jsonb",
    "bill_to_address" "jsonb"
);

CREATE TABLE IF NOT EXISTS "public"."data_purge_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "performed_by" "text",
    "performed_by_role" "text",
    "counts" "jsonb",
    "buckets_cleared" "jsonb",
    "stripe_customer_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "expense_id" "text",
    "payee" "text" NOT NULL,
    "payment_account" "text",
    "payment_method" "text" DEFAULT 'Credit Card'::"text",
    "payment_date" "date" NOT NULL,
    "ref_number" "text",
    "line_items" "jsonb" DEFAULT '[]'::"jsonb",
    "memo" "text",
    "attachment_url" "text",
    "total" numeric NOT NULL,
    "is_recurring" boolean DEFAULT false,
    "recurring_end_date" "date",
    "linked_order_id" "text",
    "auto_generation_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "qb_expense_id" "text",
    "qb_synced_at" timestamp with time zone,
    CONSTRAINT "expenses_total_nonneg" CHECK (("total" >= (0)::numeric))
);

CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "item" "text",
    "sku" "text",
    "category" "text",
    "qty" integer DEFAULT 0,
    "unit" "text",
    "reorder" integer DEFAULT 0,
    "cost" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ss_style_number" "text",
    "ss_color" "text",
    "restock_to" integer DEFAULT 0,
    "supplier" "text",
    "ordered_at" timestamp with time zone,
    "ordered_qty" integer
);

CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "text",
    "shop_owner" "text" NOT NULL,
    "customer_id" "text",
    "customer_name" "text",
    "order_id" "text",
    "total" numeric,
    "paid" boolean DEFAULT false,
    "paid_date" "date",
    "status" "text" DEFAULT 'Pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "date" "date",
    "due" "date",
    "subtotal" numeric DEFAULT 0,
    "tax" numeric DEFAULT 0,
    "line_items" "jsonb" DEFAULT '[]'::"jsonb",
    "notes" "text",
    "rush_rate" numeric DEFAULT 0,
    "extras" "jsonb" DEFAULT '{}'::"jsonb",
    "discount" numeric DEFAULT 0,
    "tax_rate" numeric DEFAULT 8.265,
    "broker_id" "text",
    "broker_name" "text",
    "discount_type" "text" DEFAULT 'percent'::"text",
    "qb_invoice_id" "text",
    "qb_payment_link" "text",
    "qb_doc_number" "text",
    "qb_subtotal" numeric,
    "qb_tax_amount" numeric,
    "qb_total" numeric,
    "setup_total" numeric,
    "additional_charges" "jsonb",
    "deposit_pct" numeric,
    "deposit_paid" boolean,
    CONSTRAINT "invoices_discount_nonneg" CHECK (("discount" >= (0)::numeric)),
    CONSTRAINT "invoices_subtotal_nonneg" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "invoices_tax_nonneg" CHECK (("tax" >= (0)::numeric)),
    CONSTRAINT "invoices_total_nonneg" CHECK (("total" >= (0)::numeric))
);

CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "text",
    "from_email" "text",
    "to_email" "text",
    "body" "text",
    "broker_id" "text",
    "shop_owner" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "from_name" "text",
    "read" boolean DEFAULT false,
    "attachment_url" "text",
    "attachment_name" "text"
);

CREATE TABLE IF NOT EXISTS "public"."mfa_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mfa_audit_log_event_check" CHECK (("event" = ANY (ARRAY['mfa_enabled'::"text", 'mfa_disabled'::"text", 'signin_code_requested'::"text", 'signin_code_verified'::"text", 'signin_code_failed'::"text", 'signin_code_expired'::"text", 'lockout'::"text", 'session_invalidated'::"text", 'trusted_device_registered'::"text", 'trusted_device_used'::"text", 'trusted_device_revoked'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."mfa_signin_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "consumed_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."mfa_trusted_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "device_label" "text",
    "last_used_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."notification_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "recipient_email" "text" NOT NULL,
    "recipient_role" "text",
    "quote_id" "uuid",
    "order_id" "uuid",
    "subject" "text",
    "status" "text" NOT NULL,
    "failure_reason" "text",
    "resend_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_log_event_type_check" CHECK (("event_type" = ANY (ARRAY['quote_approval'::"text", 'artwork_approval'::"text", 'quote_payment'::"text", 'quote_send'::"text", 'reply'::"text", 'payment_confirmation'::"text", 'trial_reminder'::"text"]))),
    CONSTRAINT "notification_log_recipient_role_check" CHECK (("recipient_role" = ANY (ARRAY['shop_owner'::"text", 'broker'::"text", 'customer'::"text"]))),
    CONSTRAINT "notification_log_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" bigint NOT NULL,
    "shop_owner" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "related_entity" "text",
    "related_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'alert'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."notifications_id_seq" OWNER TO "postgres";

ALTER SEQUENCE "public"."notifications_id_seq" OWNED BY "public"."notifications"."id";

CREATE TABLE IF NOT EXISTS "public"."payees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."payment_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "name" "text",
    "type" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."processed_webhook_events" (
    "source" "text" NOT NULL,
    "event_id" "text" NOT NULL,
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb"
);

CREATE TABLE IF NOT EXISTS "public"."profile_secrets" (
    "profile_id" "uuid" NOT NULL,
    "qb_access_token" "text",
    "qb_refresh_token" "text",
    "qb_token_expires_at" timestamp with time zone,
    "qb_realm_id" "text",
    "qb_oauth_state" "text",
    "gmail_access_token" "text",
    "gmail_refresh_token" "text",
    "gmail_token_expires_at" timestamp with time zone,
    "gmail_oauth_state" "text",
    "ac_password" "text",
    "ac_subscription_key" "text",
    "ss_api_key" "text",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ss_account_number" "text",
    "ac_email" "text",
    "qb_oauth_state_at" timestamp with time zone,
    "qb_refresh_token_expires_at" timestamp with time zone,
    "qb_token_refresh_lock" timestamp with time zone,
    "qb_last_reconciled_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_id" "uuid",
    "email" "text",
    "full_name" "text",
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "shop_name" "text",
    "logo_url" "text",
    "display_name" "text",
    "company_name" "text",
    "phone" "text",
    "address" "text",
    "website" "text",
    "notes" "text",
    "assigned_shops" "jsonb" DEFAULT '[]'::"jsonb",
    "addons" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "broker_phone" "text",
    "broker_address" "text",
    "broker_notes" "text",
    "broker_credentials" "jsonb" DEFAULT '{}'::"jsonb",
    "city" "text",
    "state" "text",
    "zip" "text",
    "default_tax_rate" numeric DEFAULT 0,
    "shop_owner" "text",
    "subscription_tier" "text" DEFAULT 'trial'::"text",
    "subscription_status" "text" DEFAULT 'trialing'::"text",
    "trial_ends_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval),
    "gmail_last_scan" timestamp with time zone,
    "founding_claimed_at" timestamp with time zone,
    "free_freight_thresholds" "jsonb" DEFAULT '{}'::"jsonb",
    "default_ac_warehouse" "text" DEFAULT 'CA'::"text",
    "first_name" "text",
    "last_name" "text",
    "mfa_email_enabled" boolean DEFAULT false NOT NULL,
    "manager_permissions" "jsonb",
    "past_due_since" timestamp with time zone,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'shop'::"text", 'manager'::"text", 'employee'::"text", 'broker'::"text", 'user'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "supplier" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "reference" "text",
    "ship_to" "jsonb",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "notes" "text",
    "courier_instructions" "text",
    "shipping_method" "text",
    "supplier_order_id" "text",
    "submit_response" "jsonb",
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "source_order_id" "uuid",
    "warehouse" "text" DEFAULT 'CA'::"text",
    CONSTRAINT "purchase_orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'cancelled'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."qb_event_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "quote_id" "uuid",
    "invoice_id" "uuid",
    "qb_invoice_id" "text",
    "qb_customer_id" "text",
    "action" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "status" "text" NOT NULL,
    "request_body" "jsonb",
    "response_body" "jsonb",
    "error_message" "text",
    "idempotency_key" "text",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "qb_event_log_direction_check" CHECK (("direction" = ANY (ARRAY['outbound'::"text", 'inbound'::"text"]))),
    CONSTRAINT "qb_event_log_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text", 'skipped'::"text", 'duplicate'::"text", 'started'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."qb_idempotency" (
    "key" "text" NOT NULL,
    "shop_owner" "text" NOT NULL,
    "action" "text" NOT NULL,
    "status" "text" NOT NULL,
    "result" "jsonb",
    "error_message" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "qb_idempotency_status_check" CHECK (("status" = ANY (ARRAY['in_flight'::"text", 'completed'::"text", 'failed'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."request_rate" (
    "rate_key" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "call_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."shop_performance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "date" "date",
    "orders" integer DEFAULT 0,
    "revenue" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "order_id" "text",
    "customer_name" "text",
    "customer_id" "text",
    "broker_id" "text",
    "total" numeric DEFAULT 0,
    "status" "text"
);

CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_email" "text" NOT NULL,
    "shop_name" "text" NOT NULL,
    "addons" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "quote_email_subject" "text",
    "quote_email_body" "text",
    "wizard_styles" "jsonb" DEFAULT '[]'::"jsonb",
    "wizard_setups" "jsonb" DEFAULT '[]'::"jsonb",
    "pricing_config" "jsonb" DEFAULT '{}'::"jsonb",
    "decoration_types" "jsonb" DEFAULT '["screen_print"]'::"jsonb",
    "timezone" "text",
    "stripe_account_id" "text",
    "stripe_account_status" "text",
    "production_tasks" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "presses" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "brand_color" "text",
    "qb_income_account_id" "text",
    "qb_income_account_name" "text",
    CONSTRAINT "shops_brand_color_check" CHECK ((("brand_color" IS NULL) OR ("brand_color" ~* '^#[0-9a-f]{6}$'::"text")))
);

CREATE TABLE IF NOT EXISTS "public"."supplier_lookup_rate" (
    "shop_owner" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "call_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."supplier_order_idempotency" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "supplier" "text",
    "status" "text" DEFAULT 'in_flight'::"text" NOT NULL,
    "supplier_order_id" "text",
    "response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "supplier_order_idempotency_status_check" CHECK (("status" = ANY (ARRAY['in_flight'::"text", 'succeeded'::"text", 'failed'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."supplier_style_cache" (
    "supplier" "text" NOT NULL,
    "shop_owner" "text" NOT NULL,
    "cache_key" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."tax_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_owner" "text" NOT NULL,
    "name" "text",
    "description" "text",
    "tax_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."tax_records" (
    "id" bigint NOT NULL,
    "shop_owner" "text" NOT NULL,
    "qb_invoice_id" "text",
    "quote_id" "text",
    "customer_id" "text",
    "customer_name" "text",
    "txn_date" "date",
    "authority" "text" DEFAULT 'quickbooks_ast'::"text" NOT NULL,
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "tax_total" numeric DEFAULT 0 NOT NULL,
    "total" numeric DEFAULT 0 NOT NULL,
    "taxable_amount" numeric DEFAULT 0 NOT NULL,
    "effective_rate" numeric,
    "ship_to_state" "text",
    "ship_to_zip" "text",
    "exempt" boolean DEFAULT false NOT NULL,
    "exemption_type" "text",
    "exemption_certificate_number" "text",
    "tax_lines" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS "public"."tax_records_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."tax_records_id_seq" OWNER TO "postgres";

ALTER SEQUENCE "public"."tax_records_id_seq" OWNED BY "public"."tax_records"."id";

DO $$ BEGIN
ALTER TABLE ONLY "public"."anon_email_rate"
    ADD CONSTRAINT "anon_email_rate_pkey" PRIMARY KEY ("rate_key", "window_start");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."artwork_objects"
    ADD CONSTRAINT "artwork_objects_pkey" PRIMARY KEY ("name");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."assistant_usage"
    ADD CONSTRAINT "assistant_usage_pkey" PRIMARY KEY ("user_id", "day");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."broker_documents"
    ADD CONSTRAINT "broker_documents_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."broker_files"
    ADD CONSTRAINT "broker_files_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."broker_notifications"
    ADD CONSTRAINT "broker_notifications_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."broker_performance"
    ADD CONSTRAINT "broker_performance_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."commissions"
    ADD CONSTRAINT "commissions_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."data_purge_log"
    ADD CONSTRAINT "data_purge_log_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."mfa_audit_log"
    ADD CONSTRAINT "mfa_audit_log_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."mfa_signin_codes"
    ADD CONSTRAINT "mfa_signin_codes_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."mfa_trusted_devices"
    ADD CONSTRAINT "mfa_trusted_devices_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."mfa_trusted_devices"
    ADD CONSTRAINT "mfa_trusted_devices_user_id_token_hash_key" UNIQUE ("user_id", "token_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."payees"
    ADD CONSTRAINT "payees_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."payment_accounts"
    ADD CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."processed_webhook_events"
    ADD CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("source", "event_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."profile_secrets"
    ADD CONSTRAINT "profile_secrets_pkey" PRIMARY KEY ("profile_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_id_key" UNIQUE ("auth_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."qb_event_log"
    ADD CONSTRAINT "qb_event_log_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."qb_idempotency"
    ADD CONSTRAINT "qb_idempotency_pkey" PRIMARY KEY ("key");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."request_rate"
    ADD CONSTRAINT "request_rate_pkey" PRIMARY KEY ("rate_key", "window_start");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."shop_performance"
    ADD CONSTRAINT "shop_performance_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."supplier_lookup_rate"
    ADD CONSTRAINT "supplier_lookup_rate_pkey" PRIMARY KEY ("shop_owner", "window_start");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."supplier_order_idempotency"
    ADD CONSTRAINT "supplier_order_idempotency_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."supplier_order_idempotency"
    ADD CONSTRAINT "supplier_order_idempotency_shop_owner_idempotency_key_key" UNIQUE ("shop_owner", "idempotency_key");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."supplier_style_cache"
    ADD CONSTRAINT "supplier_style_cache_pkey" PRIMARY KEY ("supplier", "shop_owner", "cache_key");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."tax_categories"
    ADD CONSTRAINT "tax_categories_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."tax_records"
    ADD CONSTRAINT "tax_records_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."mfa_audit_log"
    ADD CONSTRAINT "mfa_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."mfa_signin_codes"
    ADD CONSTRAINT "mfa_signin_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."mfa_trusted_devices"
    ADD CONSTRAINT "mfa_trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."profile_secrets"
    ADD CONSTRAINT "profile_secrets_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_id_fkey" FOREIGN KEY ("auth_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_possible_existing_customer_id_fkey" FOREIGN KEY ("possible_existing_customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
