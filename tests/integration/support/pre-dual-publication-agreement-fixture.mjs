import { createHash } from 'node:crypto';
import { withPostgresTransaction } from '../../../dist/apps/funding-api/src/postgres-transaction.js';

/** Seed an explicit historical agreement before migration 072, without today's write services. */
export async function recordPreDualPublicationFixtureAgreement(
  pool,
  contributionId,
  channels
) {
  if (
    !channels.length ||
    new Set(channels).size !== channels.length ||
    channels.some(
      (channel) => !['website', 'facebook', 'linkedin'].includes(channel)
    )
  )
    throw new Error('Declare the historical synthetic agreement channels.');

  await withPostgresTransaction(pool, async (db) => {
    const source = (
      await db.query(
        'SELECT amount_cents,currency FROM fund_contributions WHERE id=$1',
        [contributionId]
      )
    ).rows[0];
    const historicalOffer = {
      version: 'historical-qualification-v1',
      amountMinor: Number(source.amount_cents),
      currency: source.currency.toUpperCase(),
      benefits: channels.map((channel) => ({
        id: channel === 'website' ? 'website_mention' : `${channel}_batch`,
        channel,
        target: 'openg7',
        quantity: 1,
        requiredElements: ['company_name'],
        deadlineDays: null,
        durationDays: null,
        ...(channel === 'website' ? {} : { format: 'collective_text' })
      }))
    };
    const snapshot = JSON.stringify(historicalOffer);
    const offer = (
      await db.query(
        `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,'historical_qualification') RETURNING id`,
        [
          contributionId,
          historicalOffer.version,
          createHash('sha256').update(snapshot).digest('hex'),
          historicalOffer.amountMinor,
          historicalOffer.currency,
          snapshot
        ]
      )
    ).rows[0];
    const commitment = (
      await db.query(
        `INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,activated_at)
         VALUES($1,$2,'qualified_historical','active',NOW()) RETURNING id`,
        [contributionId, offer.id]
      )
    ).rows[0];
    for (const benefit of historicalOffer.benefits)
      await db.query(
        `INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal,publication_format)
         VALUES($1,$2,$3,$4,$5,1,$6)`,
        [
          commitment.id,
          contributionId,
          benefit.id,
          benefit.channel,
          benefit.target,
          benefit.format ?? null
        ]
      );
    await db.query(
      `INSERT INTO sponsorship_obligation_timing(obligation_id,deadline_days,duration_days)
       SELECT id,NULL,NULL FROM sponsorship_obligations WHERE commitment_id=$1`,
      [commitment.id]
    );
  });
}
