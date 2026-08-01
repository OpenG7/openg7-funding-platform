CREATE TABLE IF NOT EXISTS sponsor_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('logo', 'supporting_image')),
  review_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
  uploaded_by TEXT NOT NULL DEFAULT 'sponsor'
    CHECK (uploaded_by IN ('sponsor', 'admin')),
  original_filename TEXT NOT NULL,
  original_mime_type TEXT NOT NULL
    CHECK (original_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  original_size_bytes INTEGER NOT NULL CHECK (original_size_bytes > 0),
  original_storage_key TEXT NOT NULL UNIQUE,
  processed_mime_type TEXT NOT NULL DEFAULT 'image/webp'
    CHECK (processed_mime_type = 'image/webp'),
  processed_size_bytes INTEGER NOT NULL CHECK (processed_size_bytes > 0),
  processed_storage_key TEXT NOT NULL UNIQUE,
  public_storage_key TEXT UNIQUE,
  public_url TEXT,
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (review_status = 'approved' AND public_storage_key IS NOT NULL AND public_url IS NOT NULL)
    OR
    (review_status <> 'approved' AND public_storage_key IS NULL AND public_url IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_media_assets_active_logo
  ON sponsor_media_assets (contribution_id)
  WHERE kind = 'logo' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sponsor_media_assets_contribution
  ON sponsor_media_assets (contribution_id, kind, sort_order, created_at);

CREATE INDEX IF NOT EXISTS idx_sponsor_media_assets_review_status
  ON sponsor_media_assets (review_status, created_at)
  WHERE deleted_at IS NULL;

