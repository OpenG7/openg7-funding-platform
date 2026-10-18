import type { Pool } from 'pg';

import type {
  SponsorMediaAnalysisReceipt,
  SponsorMediaAnalysisResponse
} from '../../../../packages/funding-core/src/index.js';
import { isValidUuid } from '../business-helpers/request-validation.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';

import {
  executeAnalysisCommand,
  parseAnalysisReview,
  parseAnalysisStart
} from './commands.js';
import { projectAnalysis, readAnalysisReceipt } from './projection.js';
import { reviewAnalysisRun } from './review.js';
import { requireAnalysis } from './shared.js';
import { startAnalysisRun } from './start.js';
import {
  localTechnicalMediaAdapter,
  tickSponsorMediaAnalysis,
  type SponsorMediaAnalysisAdapter
} from './worker.js';

export { SponsorMediaAnalysisError } from './shared.js';

/** Owns source-sensitive proposals and human edits; never grants rights or an N0 decision. */
export class SponsorMediaAnalysisService {
  private readonly adapter: SponsorMediaAnalysisAdapter;
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<SponsorMediaStorage, 'readPrivateObject'>,
    options: { readonly adapter?: SponsorMediaAnalysisAdapter } = {}
  ) {
    this.adapter = options.adapter ?? localTechnicalMediaAdapter;
    requireAnalysis(
      /^[a-z][a-z0-9_]{0,99}$/.test(this.adapter.version),
      'MEDIA_ANALYSIS_ADAPTER_INVALID',
      400
    );
  }
  async read(contributionId: string): Promise<SponsorMediaAnalysisResponse> {
    requireAnalysis(isValidUuid(contributionId), 'MEDIA_ANALYSIS_INVALID', 400);
    return withPostgresTransaction(
      this.pool,
      (db) =>
        projectAnalysis(
          db,
          contributionId.toLowerCase(),
          this.adapter.capabilities
        ),
      { readOnlySnapshot: true }
    );
  }
  async receipt(
    contributionId: string,
    requestId: string,
    actor: string
  ): Promise<SponsorMediaAnalysisReceipt> {
    return readAnalysisReceipt(this.pool, contributionId, requestId, actor);
  }
  start(raw: unknown, actor: string): Promise<SponsorMediaAnalysisResponse> {
    const input = parseAnalysisStart(raw);
    return executeAnalysisCommand(
      this.pool,
      this.adapter.capabilities,
      input,
      'run',
      actor,
      (db) => startAnalysisRun(db, input, actor, this.adapter.version)
    );
  }
  review(raw: unknown, actor: string): Promise<SponsorMediaAnalysisResponse> {
    const input = parseAnalysisReview(raw);
    return executeAnalysisCommand(
      this.pool,
      this.adapter.capabilities,
      input,
      'review',
      actor,
      (db) => reviewAnalysisRun(db, input, actor)
    );
  }
  tick(): Promise<void> {
    return tickSponsorMediaAnalysis(this.pool, this.storage, this.adapter);
  }
}
