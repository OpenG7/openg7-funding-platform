-- Media approval authorizes a controlled API URL, not a public storage copy.
-- Keep historical public keys as references for separately authorized remediation.
-- No object is created/deleted and no existing media URL or review is rewritten.
ALTER TABLE sponsor_media_assets
  DROP CONSTRAINT sponsor_media_assets_check;

ALTER TABLE sponsor_media_assets
  ADD CONSTRAINT sponsor_media_assets_review_exposure_check CHECK (
    (review_status = 'approved' AND public_url IS NOT NULL)
    OR
    (review_status <> 'approved' AND public_url IS NULL)
  );
