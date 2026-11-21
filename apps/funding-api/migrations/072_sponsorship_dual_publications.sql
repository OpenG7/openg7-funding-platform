-- New offers can promise collective and individual passages on the same channel.
-- Recorded offers, their fingerprints and existing obligations remain unchanged.
ALTER TABLE sponsorship_obligations
  DROP CONSTRAINT sponsorship_obligations_benefit_id_check;
ALTER TABLE sponsorship_obligations
  ADD CONSTRAINT sponsorship_obligations_benefit_id_check CHECK (
    benefit_id IN ('website_mention','facebook_batch','linkedin_batch',
                   'facebook_individual','linkedin_individual')
  );
ALTER TABLE sponsorship_obligations
  DROP CONSTRAINT sponsorship_obligations_check1;
ALTER TABLE sponsorship_obligations
  ADD CONSTRAINT sponsorship_obligation_benefit_channel CHECK (
    (benefit_id='website_mention' AND channel='website') OR
    (benefit_id IN ('facebook_batch','facebook_individual') AND channel='facebook') OR
    (benefit_id IN ('linkedin_batch','linkedin_individual') AND channel='linkedin')
  );

ALTER TABLE sponsorship_obligations
  DROP CONSTRAINT sponsorship_obligations_publication_format_check;
ALTER TABLE sponsorship_obligations
  ADD CONSTRAINT sponsorship_obligations_publication_format_check CHECK (
    publication_format IS NULL OR publication_format IN
      ('collective_text','individual_text','individual_portrait','collective_composite','image_collection')
  );
ALTER TABLE sponsorship_obligations ADD COLUMN minimum_participants SMALLINT NOT NULL DEFAULT 1
  CHECK (minimum_participants BETWEEN 1 AND 50);
ALTER TABLE sponsorship_obligations
  ADD CONSTRAINT sponsorship_obligation_group_size CHECK (
    (channel<>'website' OR minimum_participants=1) AND
    (publication_format NOT IN ('individual_text','individual_portrait') OR minimum_participants=1) AND
    (publication_format<>'image_collection' OR minimum_participants<=10)
  );
ALTER TABLE sponsorship_obligations
  ADD CONSTRAINT sponsorship_obligation_individual_format CHECK (
    benefit_id NOT IN ('facebook_individual','linkedin_individual') OR
    (publication_format IN ('individual_text','individual_portrait')) IS TRUE
  );

ALTER TABLE publication_deliveries
  DROP CONSTRAINT publication_deliveries_publication_format_check;
ALTER TABLE publication_deliveries
  ADD CONSTRAINT publication_deliveries_publication_format_check CHECK (
    publication_format IN
      ('collective_text','individual_text','individual_portrait','collective_composite','image_collection')
  );
ALTER TABLE sponsor_publication_batches
  DROP CONSTRAINT sponsor_publication_batches_publication_format_check;
ALTER TABLE sponsor_publication_batches
  ADD CONSTRAINT sponsor_publication_batches_publication_format_check CHECK (
    publication_format IN
      ('collective_text','individual_text','individual_portrait','collective_composite','image_collection')
  );
