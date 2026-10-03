import { readFileSync } from 'node:fs';

const modules = {
  contributions: [
    'contributions-read.repository.ts',
    'contributions-dashboard.repository.ts',
    'contributions-persistence-mappers.ts',
    'contributions-persistence-helpers.ts',
    'fund-contributions.repository.ts'
  ],
  administration: [
    'fund-expenses.repository.ts',
    'fund-admin-audit.repository.ts',
    'fund-admin.persistence.ts',
    'fund-admin.repository.ts'
  ],
  transparency: [
    'fund-transparency-registry.repository.ts',
    'fund-transparency.repository.ts'
  ]
};

// Source-contract checks follow the owning implementations after extraction.
// Runtime tests continue to call the historical repository facades.
export const readFundingPersistenceSource = (domain) =>
  modules[domain]
    .map((path) => readFileSync(`apps/funding-api/src/${path}`, 'utf8'))
    .join('\n');
