/** Storage cleanup needs a confirmed rollback, not just a missing projection. */
export class SponsorMediaPersistenceError extends Error {
  constructor(
    cause: unknown,
    readonly rollbackConfirmed: boolean
  ) {
    super('Sponsor media upload persistence failed.', { cause });
    this.name = 'SponsorMediaPersistenceError';
  }
}
