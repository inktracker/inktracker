-- change_log completion: DB triggers so EVERY document change is recorded,
-- regardless of which code path made it (larger-shop work, part 2).
--
-- The client/edge writers added with change_log covered two paths (invoice
-- rename, Match-to-QuickBooks) — a partial audit log misleads: an empty
-- history reads as "nobody touched this" when the truth is "that path
-- doesn't log". Triggers close the class: any UPDATE that moves a tracked
-- field, and any DELETE, writes history by construction. Client-side field
-- loggers are retired in the same release (triggers now produce those rows,
-- with the same actor, from the JWT).
--
-- Attribution:
--   auth.uid() present  → a signed-in user's write → source 'inktracker',
--                         actor = their JWT email
--   no auth.uid()       → service-role/edge-function write → source
--                         'system', actor null (qbWebhook's explicit
--                         'quickbooks'-source rows continue to carry the
--                         QB-side story; a 'system' "Paid: no → yes" from a
--                         webhook cascade is real, wanted history)
--
-- Noise control: only TRACKED fields are compared (money, status, dates,
-- refs, press assignment, line_items) — qb_* mirror columns, snapshots, and
-- timestamps are ignored, so pullInvoices/reconcile sweeps that change
-- nothing tracked write nothing. Empty diff → no row.

CREATE OR REPLACE FUNCTION public.log_document_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_type text;
  v_ref text;
  v_changes text[] := '{}';
  v_actor text;
  v_source text;
  v_summary text;
  old_li_count int;
  new_li_count int;
BEGIN
  v_entity_type := CASE TG_TABLE_NAME
    WHEN 'invoices' THEN 'invoice'
    WHEN 'quotes' THEN 'quote'
    WHEN 'orders' THEN 'order'
  END;

  v_actor := nullif(((SELECT auth.jwt()) ->> 'email'), '');
  v_source := CASE WHEN (SELECT auth.uid()) IS NULL THEN 'system' ELSE 'inktracker' END;

  IF TG_OP = 'DELETE' THEN
    v_ref := coalesce(to_jsonb(OLD) ->> 'invoice_id', to_jsonb(OLD) ->> 'quote_id', to_jsonb(OLD) ->> 'order_id');
    INSERT INTO public.change_log
      (shop_owner, entity_type, entity_id, entity_ref, source, actor, summary, changes, metadata)
    VALUES
      (OLD.shop_owner, v_entity_type, OLD.id::text, v_ref, v_source, v_actor,
       CASE WHEN v_source = 'system' THEN 'Deleted (automated)' ELSE 'Deleted' END,
       '[]'::jsonb, '{}'::jsonb);
    RETURN OLD;
  END IF;

  -- ── UPDATE: diff tracked fields (to_jsonb so one function serves the
  --    three tables despite differing columns; absent keys are skipped).
  DECLARE
    o jsonb := to_jsonb(OLD);
    n jsonb := to_jsonb(NEW);
    fld record;
  BEGIN
    FOR fld IN
      SELECT * FROM (VALUES
        ('total',          'Total',        'money'),
        ('subtotal',       'Subtotal',     'money'),
        ('tax',            'Tax',          'money'),
        ('tax_rate',       'Tax rate',     'pct'),
        ('discount',       'Discount',     'raw'),
        ('discount_type',  'Discount type','raw'),
        ('status',         'Status',       'raw'),
        ('paid',           'Paid',         'bool'),
        ('paid_date',      'Paid date',    'raw'),
        ('due',            'Due date',     'raw'),
        ('due_date',       'Due date',     'raw'),
        ('date',           'Date',         'raw'),
        ('customer_name',  'Customer',     'raw'),
        ('invoice_id',     'Invoice #',    'raw'),
        ('quote_id',       'Quote #',      'raw'),
        ('order_id',       'Order #',      'raw'),
        ('scheduled_date', 'Scheduled',    'raw'),
        ('assigned_press', 'Press',        'raw'),
        ('assigned_operator','Operator',   'raw'),
        ('job_title',      'Job',          'raw')
      ) AS t(key, label, kind)
    LOOP
      IF (o ? fld.key) OR (n ? fld.key) THEN
        IF (o -> fld.key) IS DISTINCT FROM (n -> fld.key) THEN
          -- Money at cent precision so float noise doesn't manufacture rows.
          IF fld.kind = 'money' AND
             round(coalesce((o ->> fld.key)::numeric, 0), 2) = round(coalesce((n ->> fld.key)::numeric, 0), 2) THEN
            CONTINUE;
          END IF;
          v_changes := v_changes || (
            fld.label || ': ' ||
            CASE fld.kind
              WHEN 'money' THEN '$' || to_char(coalesce((o ->> fld.key)::numeric, 0), 'FM999999990.00')
              WHEN 'bool'  THEN CASE WHEN coalesce((o ->> fld.key)::boolean, false) THEN 'yes' ELSE 'no' END
              ELSE coalesce(nullif(o ->> fld.key, ''), '—')
            END
            || ' → ' ||
            CASE fld.kind
              WHEN 'money' THEN '$' || to_char(coalesce((n ->> fld.key)::numeric, 0), 'FM999999990.00')
              WHEN 'bool'  THEN CASE WHEN coalesce((n ->> fld.key)::boolean, false) THEN 'yes' ELSE 'no' END
              ELSE coalesce(nullif(n ->> fld.key, ''), '—')
            END
          );
        END IF;
      END IF;
    END LOOP;

    -- line_items: count moves name themselves; content-only edits get a
    -- generic entry. Never dump the itemization into the log.
    IF (o ? 'line_items') AND ((o -> 'line_items') IS DISTINCT FROM (n -> 'line_items')) THEN
      old_li_count := coalesce(jsonb_array_length(nullif(o -> 'line_items', 'null'::jsonb)), 0);
      new_li_count := coalesce(jsonb_array_length(nullif(n -> 'line_items', 'null'::jsonb)), 0);
      IF new_li_count > old_li_count THEN
        v_changes := v_changes || (format('%s line item(s) added', new_li_count - old_li_count));
      ELSIF new_li_count < old_li_count THEN
        v_changes := v_changes || (format('%s line item(s) removed', old_li_count - new_li_count));
      ELSE
        v_changes := v_changes || 'Line items edited'::text;
      END IF;
    END IF;

    IF array_length(v_changes, 1) IS NULL THEN
      RETURN NEW; -- nothing tracked moved (qb_* mirror sweeps, timestamps)
    END IF;

    v_ref := coalesce(n ->> 'invoice_id', n ->> 'quote_id', n ->> 'order_id');
    v_summary := CASE WHEN v_source = 'system'
      THEN format('Updated automatically — %s change%s', array_length(v_changes, 1),
                  CASE WHEN array_length(v_changes, 1) = 1 THEN '' ELSE 's' END)
      ELSE format('Edited — %s change%s', array_length(v_changes, 1),
                  CASE WHEN array_length(v_changes, 1) = 1 THEN '' ELSE 's' END)
    END;

    INSERT INTO public.change_log
      (shop_owner, entity_type, entity_id, entity_ref, source, actor, summary, changes, metadata)
    VALUES
      (NEW.shop_owner, v_entity_type, NEW.id::text, v_ref, v_source, v_actor, v_summary,
       to_jsonb(v_changes), '{}'::jsonb);
    RETURN NEW;
  END;
EXCEPTION WHEN OTHERS THEN
  -- The audit log must NEVER break the business write it describes —
  -- same contract as every other change_log writer. Log and pass through.
  RAISE WARNING 'log_document_change failed on %.%: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.log_document_change() FROM public;

DROP TRIGGER IF EXISTS invoices_change_log ON public.invoices;
CREATE TRIGGER invoices_change_log
  AFTER UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.log_document_change();

DROP TRIGGER IF EXISTS quotes_change_log ON public.quotes;
CREATE TRIGGER quotes_change_log
  AFTER UPDATE OR DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.log_document_change();

DROP TRIGGER IF EXISTS orders_change_log ON public.orders;
CREATE TRIGGER orders_change_log
  AFTER UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_document_change();
