CREATE TABLE publication_editorial_profiles (
  feed_id text PRIMARY KEY REFERENCES publication_feeds(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  preferences jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preferences) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO publication_editorial_profiles(feed_id) SELECT id FROM publication_feeds;

-- Counts reflect distinct accepted edits, never raw keystrokes or private text.
CREATE TABLE publication_editorial_observations (
  delivery_id uuid NOT NULL REFERENCES publication_deliveries(id),
  feed_id text NOT NULL REFERENCES publication_feeds(id),
  intent text NOT NULL CHECK (intent IN ('concise','neutral','project_first','linkedin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_id, intent)
);
CREATE INDEX publication_editorial_observations_feed_idx ON publication_editorial_observations(feed_id, intent);
