-- Preserve each published draft and batch while preparing the next recorded passage.
ALTER TABLE sponsor_publication_drafts ADD COLUMN obligation_id UUID;
ALTER TABLE sponsor_publication_drafts ADD CONSTRAINT publication_draft_owned_obligation
  FOREIGN KEY(obligation_id,contribution_id) REFERENCES sponsorship_obligations(id,contribution_id);
DROP INDEX idx_sponsor_publication_drafts_unique_channel;
CREATE UNIQUE INDEX idx_sponsor_publication_drafts_unique_channel
  ON sponsor_publication_drafts(contribution_id,feed_target,channel) WHERE obligation_id IS NULL;
CREATE UNIQUE INDEX idx_publication_draft_open_obligation
  ON sponsor_publication_drafts(obligation_id)
  WHERE obligation_id IS NOT NULL AND status NOT IN ('published','cancelled','rejected');
ALTER TABLE sponsor_publication_batches ADD COLUMN publication_format TEXT
  CHECK(publication_format IN ('collective_text','individual_portrait','collective_composite','image_collection'));

-- Existing draft snapshots remain byte-compatible. A new binding is reviewed as content.
ALTER FUNCTION moderation_snapshot(TEXT,UUID) RENAME TO moderation_snapshot_before_draft_passages;
CREATE FUNCTION moderation_snapshot(subject_kind TEXT,subject_uuid UUID) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE content JSONB; passage UUID;
BEGIN
  content:=moderation_snapshot_before_draft_passages(subject_kind,subject_uuid);
  IF subject_kind='publication_draft' THEN
    SELECT obligation_id INTO passage FROM sponsor_publication_drafts WHERE id=subject_uuid;
    IF passage IS NOT NULL THEN content:=content || jsonb_build_object('obligationId',passage); END IF;
  END IF;
  RETURN content;
END $$;
CREATE FUNCTION publication_draft_passage_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.obligation_id IS DISTINCT FROM NEW.obligation_id THEN
    PERFORM moderation_refresh_subject('publication_draft',NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_draft_passage_changed AFTER UPDATE OF obligation_id ON sponsor_publication_drafts
  FOR EACH ROW EXECUTE FUNCTION publication_draft_passage_changed();
