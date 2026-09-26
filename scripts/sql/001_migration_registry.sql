-- Runner metadata, separate from the immutable application migration sequence.
CREATE TABLE public.openg7_schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  recorded_by NAME NOT NULL DEFAULT current_user,
  action TEXT NOT NULL CHECK (action IN ('applied', 'baseline')),
  baseline_reference TEXT,
  CHECK ((action = 'baseline') = (baseline_reference IS NOT NULL))
);
