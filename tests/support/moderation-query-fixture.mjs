// These unit fixtures already have an explicit current N0 for their synthetic
// subjects. Real decision creation, invalidation and refusal are covered by the
// moderation unit tests and disposable PostgreSQL integration tests.
export function moderationQueryFixture(sql, contributionIds = []) {
  if (sql.startsWith('SELECT d.level,c.state'))
    return {
      rows: [
        {
          level: 'N0',
          state: 'approved',
          editorial_status: 'approved',
          content_version: 1,
          current_content_version: 1,
          content_fingerprint: 'a'.repeat(64),
          current_fingerprint: 'a'.repeat(64),
          actual_fingerprint: 'a'.repeat(64)
        }
      ],
      rowCount: 1
    };
  if (sql.startsWith('SELECT DISTINCT contribution_id'))
    return {
      rows: contributionIds.map((contribution_id) => ({ contribution_id })),
      rowCount: contributionIds.length
    };
  if (sql.startsWith('SELECT draft.id FROM sponsor_publication_drafts draft'))
    return { rows: [], rowCount: 0 };
  return undefined;
}
