CREATE TABLE expense_creation_receipts (
  request_id UUID PRIMARY KEY,
  actor TEXT NOT NULL CHECK (length(btrim(actor)) > 0),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  expense_id BIGINT NOT NULL REFERENCES fund_allocations(id),
  expense_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(expense_snapshot) = 'object'
    AND expense_snapshot->>'id' = expense_id::text
  ),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
