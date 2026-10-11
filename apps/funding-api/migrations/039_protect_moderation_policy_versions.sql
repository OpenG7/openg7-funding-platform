-- A dedicated API role may lock an approved policy, never rename or activate it.
CREATE FUNCTION moderation_policy_version_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'OG7_MODERATION_POLICY_VERSION_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_policy_version_immutable BEFORE UPDATE OF version ON moderation_policies
  FOR EACH ROW EXECUTE FUNCTION moderation_policy_version_immutable();

-- NULL must not satisfy an adverse-decision evidence constraint.
ALTER TABLE moderation_decisions ADD CONSTRAINT moderation_adverse_evidence_required CHECK (
  level='N0' OR (internal_reason IS NOT NULL AND sponsor_explanation IS NOT NULL
    AND length(btrim(internal_reason))>0 AND length(btrim(sponsor_explanation))>0));
