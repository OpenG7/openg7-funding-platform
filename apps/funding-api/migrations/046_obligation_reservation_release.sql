-- Release transient reservations using the runtime role's existing UPDATE grant.
-- No DELETE privilege on sponsorship history or coordination is necessary.
ALTER TABLE sponsorship_obligation_reservations ADD COLUMN released_at TIMESTAMPTZ;
