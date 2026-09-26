-- Fixed diagnostic queries, never application mutations or migrations.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog, public;
WITH currencies AS (
  SELECT lower(currency) AS currency FROM public.fund_contributions
  UNION SELECT lower(currency) FROM public.fund_transactions
  UNION SELECT lower(currency) FROM public.sponsorship_invoices
  UNION SELECT lower(currency) FROM public.sponsorship_credit_notes
), totals AS (
  SELECT currency,
    (SELECT COALESCE(sum(amount_cents),0)::text FROM public.fund_contributions c WHERE lower(c.currency)=v.currency AND status IN ('paid','refunded','disputed')) AS contribution_received_minor,
    (SELECT COALESCE(sum(amount),0)::text FROM public.fund_transactions t WHERE lower(t.currency)=v.currency AND type='payment_intent.succeeded') AS payment_gross_minor,
    (SELECT COALESCE(sum(fee),0)::text FROM public.fund_transactions t WHERE lower(t.currency)=v.currency AND type='payment_intent.succeeded') AS payment_fees_minor,
    (SELECT COALESCE(sum(net),0)::text FROM public.fund_transactions t WHERE lower(t.currency)=v.currency AND type='payment_intent.succeeded') AS payment_net_minor,
    (SELECT COALESCE(sum(amount),0)::text FROM public.fund_transactions t WHERE lower(t.currency)=v.currency AND type='charge.refunded') AS refunds_minor,
    (SELECT COALESCE(sum(total_cents),0)::text FROM public.sponsorship_invoices i WHERE lower(i.currency)=v.currency) AS invoices_minor,
    (SELECT COALESCE(sum(total_cents),0)::text FROM public.sponsorship_credit_notes n WHERE lower(n.currency)=v.currency) AS credit_notes_minor
  FROM currencies v WHERE currency ~ '^[a-z]{3}$'
), active_media AS (
  SELECT id, original_storage_key, original_size_bytes, processed_storage_key,
    processed_size_bytes, checksum_sha256, public_storage_key, public_url, review_status
  FROM public.sponsor_media_assets WHERE deleted_at IS NULL ORDER BY id LIMIT 10001
), logos AS (
  SELECT id, sponsor_logo_url AS url FROM public.fund_contributions
  WHERE sponsor_logo_url IS NOT NULL ORDER BY id LIMIT 10001
)
SELECT json_build_object(
  'readOnly', current_setting('transaction_read_only') = 'on',
  'totals', COALESCE((SELECT json_agg(t ORDER BY currency) FROM totals t), '[]'::json),
  'checks', json_build_object(
    'invalid_currency', (SELECT count(*)::text FROM currencies WHERE currency !~ '^[a-z]{3}$'),
    'negative_amount', (SELECT count(*)::text FROM public.fund_transactions WHERE amount<0),
    'negative_contribution', (SELECT count(*)::text FROM public.fund_contributions WHERE amount_cents<0),
    -- Fees and net are comparable only for payment entries; refunds/payouts use provider signs.
    'payment_balance_mismatch', (SELECT count(*)::text FROM public.fund_transactions WHERE type='payment_intent.succeeded' AND amount::numeric-fee::numeric<>net::numeric),
    'duplicate_transaction_objects', (SELECT count(*)::text FROM (
      SELECT type,stripe_object_id FROM public.fund_transactions
      WHERE type IN ('payment_intent.succeeded','payout.paid','payout.failed') GROUP BY type,stripe_object_id HAVING count(*)>1
    ) d),
    -- A charge can have several legitimate partial refunds; never group refunds by charge ID.
    'duplicate_refund_objects', (SELECT count(*)::text FROM (
      SELECT COALESCE(NULLIF(metadata_json->>'refundId',''),CASE WHEN stripe_object_id LIKE 're\_%' ESCAPE '\' THEN stripe_object_id END) AS refund_id
      FROM public.fund_transactions WHERE type='charge.refunded' GROUP BY 1 HAVING count(*)>1
    ) d WHERE refund_id IS NOT NULL),
    'duplicate_contribution_payments', (SELECT count(*)::text FROM (
      SELECT stripe_payment_intent_id FROM public.fund_contributions WHERE stripe_payment_intent_id IS NOT NULL AND status IN ('paid','refunded','disputed') GROUP BY stripe_payment_intent_id HAVING count(*)>1
    ) d),
    'invoice_arithmetic', (SELECT count(*)::text FROM public.sponsorship_invoices WHERE total_cents::bigint<>subtotal_cents::bigint+tax_cents::bigint),
    'invoice_contribution_mismatch', (SELECT count(*)::text FROM public.sponsorship_invoices i LEFT JOIN public.fund_contributions c ON c.id=i.contribution_id
      WHERE c.id IS NULL OR lower(i.currency)<>lower(c.currency) OR i.total_cents<>c.amount_cents OR i.stripe_session_id IS DISTINCT FROM c.stripe_session_id),
    'missing_sponsorship_invoice', (SELECT count(*)::text FROM public.fund_contributions c WHERE contribution_type='sponsorship_interest' AND status IN ('paid','refunded','disputed') AND stripe_session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sponsorship_invoices i WHERE i.contribution_id=c.id)),
    'credit_note_arithmetic', (SELECT count(*)::text FROM public.sponsorship_credit_notes WHERE total_cents::bigint<>subtotal_cents::bigint+tax_cents::bigint),
    'credit_note_invoice_mismatch', (SELECT count(*)::text FROM public.sponsorship_credit_notes n LEFT JOIN public.sponsorship_invoices i ON i.id=n.invoice_id
      WHERE i.id IS NULL OR n.contribution_id<>i.contribution_id OR lower(n.currency)<>lower(i.currency) OR n.invoice_number<>i.invoice_number),
    'credits_exceed_invoice', (SELECT count(*)::text FROM public.sponsorship_invoices i WHERE (SELECT COALESCE(sum(total_cents),0) FROM public.sponsorship_credit_notes n WHERE n.invoice_id=i.id AND lower(n.currency)=lower(i.currency))>i.total_cents)
  ),
  'review', json_build_object(
    'payment_fees_unconfirmed', (SELECT count(*)::text FROM public.fund_transactions WHERE type='payment_intent.succeeded' AND stripe_balance_transaction_id IS NULL),
    -- Currency conversion or partially reconciled history needs review, never an automatic repair.
    'payment_contribution_difference', (SELECT count(*)::text FROM public.fund_contributions c JOIN public.fund_transactions t ON t.stripe_object_id=c.stripe_payment_intent_id AND t.type='payment_intent.succeeded'
      WHERE c.status IN ('paid','refunded','disputed') AND (c.amount_cents<>t.amount OR lower(c.currency)<>lower(t.currency)))
  ),
  'queues', json_build_object(
    'emails', (SELECT count(*)::text FROM public.email_messages WHERE status IN ('queued','sending','failed')),
    'email_outcome_uncertain', (SELECT count(*)::text FROM public.email_messages WHERE status='sending'),
    'stripe_events', (SELECT count(*)::text FROM public.stripe_events WHERE processing_status<>'processed'),
    'social_jobs', (SELECT count(*)::text FROM public.social_publication_jobs WHERE status IN ('pending','publishing','failed')),
    'social_deliveries', (SELECT count(*)::text FROM public.publication_deliveries WHERE status IN ('approved','publishing','uncertain','blocked')),
    'social_outcome_uncertain', (SELECT count(*)::text FROM public.publication_deliveries WHERE status IN ('publishing','uncertain')),
    'operations_alerts', (SELECT count(*)::text FROM public.operations_alerts WHERE delivered_at IS NULL AND resolved_at IS NULL),
    'active_feeds', (SELECT count(*)::text FROM public.publication_feeds WHERE NOT paused)
  ),
  'workerOverride', (SELECT enabled FROM public.publication_worker_settings WHERE id=TRUE),
  'media', COALESCE((SELECT json_agg(m) FROM active_media m), '[]'::json),
  'logos', COALESCE((SELECT json_agg(l) FROM logos l), '[]'::json)
);
ROLLBACK;
