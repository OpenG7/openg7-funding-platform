CREATE TABLE sponsorship_information_request_receipts (
  request_id UUID PRIMARY KEY,
  actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  message_id UUID NOT NULL REFERENCES email_messages(id),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE FUNCTION protect_sponsorship_information_request_receipt()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sponsorship information request receipts are immutable';
END;
$$;

CREATE TRIGGER sponsorship_information_request_receipts_immutable
  BEFORE UPDATE OR DELETE ON sponsorship_information_request_receipts
  FOR EACH ROW EXECUTE FUNCTION protect_sponsorship_information_request_receipt();
