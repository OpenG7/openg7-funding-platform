import type { Pool } from 'pg';

import {
  type ContributionFundTransactionBalanceUpdate,
  type FundTransactionInsert,
  insertFundTransaction as persistFundTransaction,
  updateContributionFundTransactionBalance as enrichContributionFundTransactionBalance
} from './fund-transparency-registry.repository.js';

export {
  getPublicTransparencySummary,
  getAdjustmentTotals
} from './fund-transparency-summary.repository.js';
export { listPublicBuilders } from './public-builders.repository.js';

export const insertFundTransaction = async (
  pool: Pool | null,
  transaction: FundTransactionInsert
): Promise<boolean> => persistFundTransaction(pool, transaction);

export const updateContributionFundTransactionBalance = async (
  pool: Pool | null,
  input: ContributionFundTransactionBalanceUpdate
): Promise<boolean> => enrichContributionFundTransactionBalance(pool, input);
