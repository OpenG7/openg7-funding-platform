import { randomUUID } from 'node:crypto';
import { withPostgresTransaction } from '../../../dist/apps/funding-api/src/postgres-transaction.js';
import { qualifySponsorshipCommitment } from '../../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';

/** A synthetic agreement is explicit test input; it never infers a historical promise from a price list. */
export async function recordFixtureSponsorshipAgreement(
  pool,
  contributionId,
  {
    channel,
    channels = channel ? [channel] : [],
    target = 'openg7',
    quantity = 1,
    benefits = channels.map((channel) => ({ channel, target, quantity }))
  }
) {
  if (
    !benefits.length ||
    new Set(benefits.map((benefit) => benefit.channel)).size !==
      benefits.length ||
    benefits.some(
      (value) =>
        !['website', 'facebook', 'linkedin'].includes(value.channel) ||
        !['openg7', 'openg20'].includes(value.target) ||
        !Number.isInteger(value.quantity) ||
        value.quantity < 1 ||
        value.quantity > 100
    )
  )
    throw new Error(
      'Declare the channels in the synthetic sponsorship agreement.'
    );
  return withPostgresTransaction(pool, async (db) => {
    const source = (
      await db.query(
        'SELECT amount_cents,currency FROM fund_contributions WHERE id=$1',
        [contributionId]
      )
    ).rows[0];
    const commitment = (
      await db.query(
        `INSERT INTO sponsorship_commitments(contribution_id,provenance,state,qualification_reason)
      VALUES($1,'historical_unverified','needs_confirmation','synthetic_agreement_to_record')
      ON CONFLICT(contribution_id) DO UPDATE SET contribution_id=EXCLUDED.contribution_id RETURNING version,state`,
        [contributionId]
      )
    ).rows[0];
    if (commitment.state === 'active') return;
    return qualifySponsorshipCommitment(
      db,
      {
        requestId: randomUUID(),
        contributionId,
        expectedVersion: commitment.version,
        confirmation: contributionId,
        reason: 'An explicit synthetic agreement is part of this test fixture',
        evidenceReference: 'synthetic://publication-agreement',
        offer: {
          version: 'historical-qualification-v1',
          amountMinor: Number(source.amount_cents),
          currency: source.currency.toUpperCase(),
          benefits: benefits.map(
            ({ channel, target, quantity, format = 'collective_text' }) => ({
              id:
                channel === 'website' ? 'website_mention' : `${channel}_batch`,
              channel,
              target,
              quantity,
              requiredElements: ['company_name'],
              deadlineDays: null,
              durationDays: null,
              ...(channel === 'website' ? {} : { format })
            })
          )
        }
      },
      'admin:00000000-0000-4000-8000-000000000004'
    );
  });
}
