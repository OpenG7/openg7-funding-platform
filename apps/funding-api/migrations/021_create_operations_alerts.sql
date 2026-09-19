CREATE TABLE operations_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_key text NOT NULL,
  incident_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid
);
CREATE UNIQUE INDEX operations_alerts_active ON operations_alerts(incident_key) WHERE resolved_at IS NULL;
CREATE INDEX operations_alerts_pending ON operations_alerts(next_attempt_at) WHERE delivered_at IS NULL AND resolved_at IS NULL;
