-- NULL preserves the existing server default until an administrator decides.
CREATE TABLE publication_worker_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled BOOLEAN,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO publication_worker_settings (id) VALUES (TRUE);
