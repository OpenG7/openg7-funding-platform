import { buildAccountingSeedFragments } from './accounting.mjs';
import { buildSponsorshipSeedFragments } from './sponsorship.mjs';

export function buildE2eSeedSql({
  sponsorshipFixtures,
  webhookFixtures,
  accountingFixtures,
  backfillFixtures,
  emailQueueFixture,
  cleanupOnly = false
}) {
  const fixtures = Object.values(sponsorshipFixtures);
  const accounting = buildAccountingSeedFragments({
    webhookFixtures,
    accountingFixtures,
    backfillFixtures,
    emailQueueFixture
  });
  const sponsorship = buildSponsorshipSeedFragments({
    fixtures,
    publicationFixtures: [...fixtures, ...accounting.publicationFixtures]
  });

  const statements = cleanupOnly
    ? [
        sponsorship.publicationCleanup,
        sponsorship.deleteStatements,
        accounting.emailQueueDelete,
        accounting.webhookFixtureDeletes,
        accounting.accountingPendingDeletes,
        accounting.accountingExpiredDelete,
        accounting.accountingExpenseDelete,
        accounting.fundTransactionsByEventDelete,
        accounting.fundTransactionsByObjectDelete,
        accounting.stripeEventsDelete,
        accounting.stripeCheckoutSessionsDelete,
        accounting.backfillContributionsDelete
      ]
    : [
        sponsorship.publicationCleanup,
        sponsorship.deleteStatements,
        sponsorship.insertStatements,
        sponsorship.sponsorMediaInsertStatements,
        accounting.emailQueueDelete,
        accounting.emailQueueInsert,
        accounting.webhookFixtureDeletes,
        accounting.webhookFixtureInserts,
        accounting.accountingPendingDeletes,
        accounting.accountingPendingInserts,
        accounting.accountingExpiredDelete,
        accounting.accountingExpenseDelete,
        accounting.accountingExpenseInsert,
        accounting.fundTransactionsByEventDelete,
        accounting.fundTransactionsByObjectDelete,
        accounting.stripeEventsDelete,
        accounting.stripeCheckoutSessionsDelete,
        accounting.backfillContributionsDelete,
        accounting.ledgerSentinelInsert
      ];

  return `BEGIN;\n${statements.join('\n')}\nCOMMIT;`;
}
