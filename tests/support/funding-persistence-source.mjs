import { readFileSync } from 'node:fs';

const modules = {
  contributions: [
    'contributions-read.repository.ts',
    'contributions-write.repository.ts',
    'contributions-dashboard.repository.ts',
    'contributions-persistence-mappers.ts',
    'contributions-persistence-helpers.ts',
    'sponsorship-persistence-helpers.ts',
    'stripe-event-records.repository.ts',
    'sponsorship-admin-read.repository.ts',
    'sponsorship-decisions.repository.ts',
    'sponsorship-refund-workflow.repository.ts',
    'public-sponsorships.repository.ts',
    'sponsorship-followup.repository.ts',
    'fund-contributions.repository.ts'
  ],
  administration: [
    'fund-expenses.repository.ts',
    'fund-admin-audit.repository.ts',
    'fund-publication-calendar.repository.ts',
    'fund-admin.persistence.ts',
    'fund-publication-content.ts',
    'fund-publication-drafts.repository.ts',
    'fund-publication-batches.repository.ts',
    'social-publication-jobs.repository.ts',
    'fund-admin.repository.ts'
  ],
  email: [
    'email-queue-read.repository.ts',
    'email-queue.persistence.ts',
    'email-queue.repository.ts'
  ],
  transparency: [
    'fund-transparency-registry.repository.ts',
    'fund-transparency-presence.repository.ts',
    'fund-transparency-projection.ts',
    'public-builders.repository.ts',
    'public-allocations.repository.ts',
    'fund-transparency-summary.repository.ts',
    'fund-transparency.repository.ts'
  ]
};

// Source-contract checks follow the owning implementations after extraction.
// Runtime tests continue to call the historical repository facades.
export const readFundingPersistenceSource = (domain) =>
  modules[domain]
    .map((path) => readFileSync(`apps/funding-api/src/${path}`, 'utf8'))
    .join('\n');
