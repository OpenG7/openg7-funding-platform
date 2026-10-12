import { sha256Hex, sqlLiteral } from './sql.mjs';

/** Declared test terms are independent of the current price list and routing UI. */
export function syntheticSponsorshipAgreement(fixture) {
  const channels = fixture.agreedChannels;
  if (!channels) return null;
  if (
    !channels.length ||
    new Set(channels).size !== channels.length ||
    channels.some(
      (channel) => !['website', 'facebook', 'linkedin'].includes(channel)
    )
  )
    throw new Error('Invalid explicitly agreed fixture channels.');
  return {
    version: 'historical-qualification-v1',
    amountMinor: fixture.amountCents,
    currency: 'CAD',
    benefits: channels.map((channel) => ({
      id: channel === 'website' ? 'website_mention' : `${channel}_batch`,
      channel,
      target: fixture.feedTarget ?? 'openg7',
      quantity: 1,
      requiredElements: ['company_name', 'approved_presentation'],
      deadlineDays: null,
      durationDays: null,
      ...(channel === 'website' ? {} : { format: 'collective_text' })
    }))
  };
}

export function buildSyntheticAgreementSql(fixtures) {
  return fixtures
    .map((fixture) => {
      const snapshot = syntheticSponsorshipAgreement(fixture);
      if (!snapshot)
        return `
INSERT INTO sponsorship_commitments(contribution_id,provenance,state,qualification_reason)
SELECT id,'historical_unverified','needs_confirmation','synthetic_offer_not_recorded'
FROM fund_contributions WHERE public_reference=${sqlLiteral(fixture.publicReference)};`;
      const serialized = JSON.stringify(snapshot);
      const snapshotSql = `${sqlLiteral(serialized)}::jsonb`;
      return `
WITH fixture_contribution AS (
  SELECT id FROM fund_contributions WHERE public_reference=${sqlLiteral(fixture.publicReference)}
), fixture_offer AS (
  INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
  VALUES(${sqlLiteral(fixture.publicReference)},${sqlLiteral(snapshot.version)},${sqlLiteral(sha256Hex(serialized))},${snapshot.amountMinor},'CAD',${snapshotSql},'historical_qualification')
  RETURNING id
), fixture_commitment AS (
  INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,qualification_reason,activated_at)
  SELECT c.id,o.id,'qualified_historical','active','Explicit synthetic agreement declared in the acceptance fixture',clock_timestamp()
  FROM fixture_contribution c CROSS JOIN fixture_offer o RETURNING id,contribution_id
)
INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal,publication_format)
SELECT c.id,c.contribution_id,b->>'id',b->>'channel',b->>'target',1,b->>'format'
FROM fixture_commitment c CROSS JOIN jsonb_array_elements(${snapshotSql}->'benefits') b;
INSERT INTO sponsorship_commitment_changes(request_id,request_fingerprint,commitment_id,kind,actor,reason,evidence_reference,previous_value,resulting_value)
SELECT gen_random_uuid(),${sqlLiteral(sha256Hex(`${fixture.publicReference}:${serialized}`))},id,'qualification','e2e-seed',
  'Explicit synthetic agreement declared in the acceptance fixture','synthetic://acceptance-agreement',
  '{"state":"needs_confirmation"}'::jsonb,${snapshotSql}
FROM sponsorship_commitments WHERE contribution_id=(SELECT id FROM fund_contributions WHERE public_reference=${sqlLiteral(fixture.publicReference)});`;
    })
    .join('\n');
}
