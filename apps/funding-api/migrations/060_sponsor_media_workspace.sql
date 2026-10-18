-- Media rules are evidence-backed, versioned references, never copied licenses.
CREATE TABLE sponsor_media_workspaces (
  contribution_id UUID PRIMARY KEY REFERENCES fund_contributions(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TABLE sponsor_media_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,contribution_id)
);
ALTER TABLE sponsor_media_assets
  ADD COLUMN media_batch_id UUID,
  ADD COLUMN usage_inheritance TEXT NOT NULL DEFAULT 'legacy'
    CHECK (usage_inheritance IN ('legacy','inherit','override')),
  ADD COLUMN website_selected BOOLEAN NOT NULL DEFAULT TRUE,
  ADD CONSTRAINT sponsor_media_batch_owner FOREIGN KEY(media_batch_id,contribution_id)
    REFERENCES sponsor_media_batches(id,contribution_id);
CREATE INDEX idx_sponsor_media_batch ON sponsor_media_assets(contribution_id,media_batch_id)
  WHERE deleted_at IS NULL;
CREATE TABLE sponsor_media_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('dossier','batch','media')),
  scope_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  usage_rights JSONB CHECK(usage_rights IS NULL OR jsonb_typeof(usage_rights)='object'),
  evidence_reference TEXT NOT NULL CHECK(length(evidence_reference) BETWEEN 10 AND 1000),
  authorization_scope TEXT NOT NULL CHECK(authorization_scope IN ('scope','selected')),
  covered_asset_ids UUID[] NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(contribution_id,scope_type,scope_id,revision),
  CHECK(usage_rights IS NULL OR authorization_scope='scope' OR cardinality(covered_asset_ids)>0)
);
CREATE INDEX idx_sponsor_media_current_rule ON sponsor_media_rule_versions
  (contribution_id,scope_type,scope_id,revision DESC);
CREATE TRIGGER sponsor_media_rule_versions_immutable BEFORE UPDATE OR DELETE ON sponsor_media_rule_versions
  FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();
CREATE TABLE sponsor_media_workspace_commands (
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_id UUID NOT NULL,
  payload_fingerprint TEXT NOT NULL CHECK(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(contribution_id,request_id)
);
CREATE TRIGGER sponsor_media_workspace_commands_immutable BEFORE UPDATE OR DELETE ON sponsor_media_workspace_commands
  FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();
CREATE TABLE sponsor_media_batch_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id UUID NOT NULL REFERENCES fund_contributions(id),
  request_id UUID NOT NULL,
  payload_fingerprint TEXT NOT NULL CHECK(payload_fingerprint ~ '^[a-f0-9]{64}$'),
  actor TEXT NOT NULL,
  workspace_revision INTEGER NOT NULL,
  plan JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(contribution_id,request_id)
);
CREATE TRIGGER sponsor_media_batch_plans_immutable BEFORE UPDATE OR DELETE ON sponsor_media_batch_plans
  FOR EACH ROW EXECUTE FUNCTION moderation_preserve_evidence();
CREATE TABLE sponsor_media_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES sponsor_media_assets(id),
  plan_id UUID NOT NULL REFERENCES sponsor_media_batch_plans(id),
  request_id UUID NOT NULL,
  original_storage_key TEXT NOT NULL,
  processed_storage_key TEXT NOT NULL,
  public_storage_key TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(asset_id,plan_id)
);

CREATE FUNCTION sponsor_media_effective_rule(asset_uuid UUID) RETURNS JSONB
LANGUAGE SQL STABLE AS $$
  SELECT CASE WHEN a.usage_inheritance='legacy' THEN NULL ELSE
    (SELECT jsonb_build_object('id',r.id,'scope',r.scope_type,'scopeId',r.scope_id,
      'revision',r.revision,'usage',r.usage_rights)
     FROM sponsor_media_rule_versions r
     WHERE r.contribution_id=a.contribution_id
       AND r.usage_rights IS NOT NULL
       AND ((a.usage_inheritance='override' AND r.scope_type='media' AND r.scope_id=a.id)
         OR (a.usage_inheritance='inherit' AND
           ((r.scope_type='batch' AND r.scope_id=a.media_batch_id)
             OR (r.scope_type='dossier' AND r.scope_id=a.contribution_id))))
     -- A newer narrowed authorization must not fall back to a broader old license.
       AND r.revision=(SELECT max(v.revision) FROM sponsor_media_rule_versions v
         WHERE v.contribution_id=r.contribution_id AND v.scope_type=r.scope_type AND v.scope_id=r.scope_id)
     ORDER BY CASE r.scope_type WHEN 'media' THEN 0 WHEN 'batch' THEN 1 ELSE 2 END
     LIMIT 1) END
  FROM sponsor_media_assets a WHERE a.id=asset_uuid
$$;
CREATE FUNCTION sponsor_media_effective_usage(asset_uuid UUID) RETURNS JSONB
LANGUAGE SQL STABLE AS $$
  SELECT CASE WHEN a.usage_inheritance='legacy' OR (a.usage_inheritance='inherit' AND a.usage_rights->>'state'='withdrawn') THEN a.usage_rights
    WHEN r.id IS NOT NULL AND (a.id=ANY(r.covered_asset_ids)
      OR (r.authorization_scope='scope' AND a.created_at>=r.created_at))
      THEN r.usage_rights
    ELSE '{"state":"needs_confirmation","channels":[],"targets":[],"transformations":[],"credit":null,"restrictions":null}'::jsonb END
  FROM sponsor_media_assets a
  LEFT JOIN sponsor_media_rule_versions r ON r.id=(sponsor_media_effective_rule(a.id)->>'id')::uuid
  WHERE a.id=asset_uuid
$$;

CREATE FUNCTION sponsor_media_prepare_inheritance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.review_status='pending_review' THEN NEW.website_selected:=FALSE; END IF;
  IF NEW.usage_rights->>'state'='needs_confirmation' AND EXISTS(
    SELECT 1 FROM sponsor_media_rule_versions r WHERE r.contribution_id=NEW.contribution_id
      AND r.scope_type='dossier' AND r.scope_id=NEW.contribution_id
      AND r.authorization_scope='scope' AND r.usage_rights->>'state'='confirmed'
      AND r.revision=(SELECT max(v.revision) FROM sponsor_media_rule_versions v
        WHERE v.contribution_id=r.contribution_id AND v.scope_type=r.scope_type AND v.scope_id=r.scope_id)
  ) THEN NEW.usage_inheritance:='inherit'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsor_media_prepare_inheritance BEFORE INSERT ON sponsor_media_assets
  FOR EACH ROW EXECUTE FUNCTION sponsor_media_prepare_inheritance();

ALTER FUNCTION moderation_snapshot(TEXT,UUID) RENAME TO moderation_snapshot_before_media_workspace;
CREATE FUNCTION moderation_snapshot(subject_kind TEXT,subject_uuid UUID) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE content JSONB; source JSONB;
BEGIN
  content:=moderation_snapshot_before_media_workspace(subject_kind,subject_uuid);
  IF subject_kind='media' AND content IS NOT NULL THEN
    source:=sponsor_media_effective_rule(subject_uuid);
    IF source IS NOT NULL OR EXISTS(SELECT 1 FROM sponsor_media_assets
      WHERE id=subject_uuid AND usage_inheritance<>'legacy') THEN
      content:=content||jsonb_build_object('usage',sponsor_media_effective_usage(subject_uuid),
        'effectiveRule',source-'usage');
    END IF;
  END IF;
  RETURN content;
END $$;

-- The application locks affected deliveries, dossier and assets before mutation.
-- No trigger grants approval or publication. Changes invalidate dependent evidence.
CREATE FUNCTION sponsor_media_invalidate_assets(asset_ids UUID[]) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE item UUID; previous_status TEXT;
BEGIN
  UPDATE sponsor_media_assets SET review_status='pending_review',public_url=NULL,
    reviewed_at=NULL,reviewed_by=NULL,usage_restrictions_reviewed=FALSE,
    website_selected=FALSE,updated_at=clock_timestamp()
    WHERE id=ANY(asset_ids) AND deleted_at IS NULL;
  FOR item IN SELECT id FROM sponsor_media_assets WHERE id=ANY(asset_ids) ORDER BY id LOOP
    PERFORM moderation_refresh_subject('media',item);
  END LOOP;
  FOR item IN SELECT DISTINCT p.id FROM publication_deliveries p
    WHERE p.media_id=ANY(asset_ids) OR EXISTS(SELECT 1 FROM publication_delivery_photos photo
      WHERE photo.delivery_id=p.id AND photo.asset_id=ANY(asset_ids) AND photo.active)
    ORDER BY p.id LOOP
    SELECT status INTO previous_status FROM publication_deliveries WHERE id=item;
    PERFORM moderation_refresh_subject('publication_delivery',item);
    UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,
      error_code='MEDIA_CHANGED',auto_managed=FALSE,version=version+1,updated_at=NOW()
      WHERE id=item AND status IN ('draft','approved','blocked');
    UPDATE publication_deliveries SET error_code='MEDIA_CHANGED',updated_at=NOW()
      WHERE id=item AND status IN ('publishing','uncertain','published');
    INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
      VALUES(COALESCE(NULLIF(current_setting('openg7.media_actor',true),''),'media-workspace'),
        'publication_automation.media_invalidated','publication_delivery',item,
        'Media authorization changed; dependent delivery requires a new explicit review.',
        jsonb_build_object('assetIds',asset_ids,'code','MEDIA_CHANGED','mediaId',CASE WHEN cardinality(asset_ids)=1 THEN asset_ids[1] ELSE NULL END,'previousStatus',previous_status,
          'requestId',NULLIF(current_setting('openg7.media_request_id',true),'')));
  END LOOP;
END $$;

CREATE FUNCTION sponsor_media_workspace_revision_changed() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sponsor_media_workspaces(contribution_id,revision) VALUES(NEW.contribution_id,1)
    ON CONFLICT(contribution_id) DO UPDATE SET revision=sponsor_media_workspaces.revision+1;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsor_media_asset_workspace_changed AFTER INSERT OR UPDATE ON sponsor_media_assets
  FOR EACH ROW EXECUTE FUNCTION sponsor_media_workspace_revision_changed();
CREATE TRIGGER sponsor_media_rule_workspace_changed AFTER INSERT ON sponsor_media_rule_versions
  FOR EACH ROW EXECUTE FUNCTION sponsor_media_workspace_revision_changed();
CREATE TRIGGER sponsor_media_batch_workspace_changed AFTER INSERT ON sponsor_media_batches
  FOR EACH ROW EXECUTE FUNCTION sponsor_media_workspace_revision_changed();

CREATE FUNCTION sponsor_media_rule_invalidates_dependents() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE affected UUID[];
BEGIN
  PERFORM set_config('openg7.media_actor',NEW.actor,true);
  PERFORM set_config('openg7.media_request_id',NEW.request_id::text,true);
  SELECT array_agg(id ORDER BY id) INTO affected FROM sponsor_media_assets
    WHERE contribution_id=NEW.contribution_id AND deleted_at IS NULL
    AND ((NEW.scope_type='media' AND id=NEW.scope_id)
      OR (NEW.scope_type='batch' AND media_batch_id=NEW.scope_id AND usage_inheritance='inherit')
      OR (NEW.scope_type='dossier' AND usage_inheritance='inherit'));
  IF affected IS NOT NULL THEN PERFORM sponsor_media_invalidate_assets(affected); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sponsor_media_rule_invalidates_dependents AFTER INSERT ON sponsor_media_rule_versions
  FOR EACH ROW EXECUTE FUNCTION sponsor_media_rule_invalidates_dependents();
