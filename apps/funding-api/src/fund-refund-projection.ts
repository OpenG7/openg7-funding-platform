/** Read legacy cumulative snapshots alongside individual facts without rewriting the ledger. */
export const effectiveRefundsSql = `
  refund_details AS (
    SELECT DISTINCT ON (metadata_json->>'refundId') * FROM fund_transactions
    WHERE type='charge.refunded' AND status='succeeded'
      AND NULLIF(metadata_json->>'refundId','') IS NOT NULL
    ORDER BY metadata_json->>'refundId', id
  ), refund_snapshots AS (
    SELECT DISTINCT ON (stripe_object_id,currency) * FROM fund_transactions
    WHERE type='charge.refunded' AND status='succeeded'
      AND NULLIF(metadata_json->>'refundId','') IS NULL
    ORDER BY stripe_object_id,currency,amount DESC,id
  ), refund_detail_totals AS (
    SELECT stripe_object_id,currency,sum(amount) AS amount FROM refund_details
    GROUP BY stripe_object_id,currency
  ), refund_remainders AS (
    SELECT s.*,GREATEST(0,s.amount-COALESCE(d.amount,0)) AS remainder
    FROM refund_snapshots s LEFT JOIN refund_detail_totals d
      ON d.stripe_object_id=s.stripe_object_id AND d.currency=s.currency
  ), effective_refunds AS (
    SELECT * FROM refund_details
    UNION ALL
    SELECT id,stripe_event_id,stripe_object_id,stripe_balance_transaction_id,type,
      remainder AS amount,0 AS fee,-remainder AS net,currency,status,created_at,
      public_category,metadata_json,inserted_at
    FROM refund_remainders WHERE remainder>0
  )
`;
