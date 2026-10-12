-- Existing immutable offer JSON/fingerprints are untouched. NULL preserves
-- unknown historical format and never creates a promise to publish an image.
ALTER TABLE sponsorship_obligations ADD COLUMN publication_format TEXT
  CHECK (publication_format IS NULL OR publication_format IN ('collective_text','individual_portrait','collective_composite','image_collection'));
ALTER TABLE sponsorship_obligations ADD CONSTRAINT sponsorship_obligation_format_channel
  CHECK (publication_format IS NULL OR channel IN ('facebook','linkedin'));
ALTER TABLE sponsorship_commitment_changes DROP CONSTRAINT sponsorship_commitment_changes_kind_check;
ALTER TABLE sponsorship_commitment_changes ADD CONSTRAINT sponsorship_commitment_changes_kind_check
  CHECK (kind IN ('qualification','destination','waiver','format'));
