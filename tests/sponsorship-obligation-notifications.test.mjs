import assert from 'node:assert/strict';
import test from 'node:test';

import { enqueueSponsorshipObligationNotification } from '../dist/apps/funding-api/src/sponsorship-commitments.repository.js';

const obligationId = '00000000-0000-4000-8000-000000000041';
const evidenceId = '00000000-0000-4000-8000-000000000043';
const input = {
  event: 'fulfilled',
  eventId: evidenceId,
  obligationId,
  obligationVersion: 2
};
const fixture = (locale = 'fr-CA') => {
  const calls = [];
  const db = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT ob.contribution_id'))
        return {
          rows: [
            {
              contributionId: '00000000-0000-4000-8000-000000000001',
              email: 'synthetic@example.invalid',
              locale,
              channel: 'linkedin',
              target: 'openg7',
              version: 2,
              evidenceId,
              deliveredAt: new Date('2026-10-11T12:00:00Z'),
              externalPostUrl: 'https://example.invalid/public-post'
            }
          ]
        };
      if (sql.includes('INSERT INTO email_messages'))
        return { rows: [{ id: '00000000-0000-4000-8000-000000000030' }] };
      assert.fail('Unexpected event/outbox query');
    }
  };
  return { db, calls };
};
test('confirmed exact obligation events are queued in FR/EN with no provider, private notes or payment assertion', async () => {
  for (const locale of ['fr-CA', 'en']) {
    const f = fixture(locale);
    assert.ok(await enqueueSponsorshipObligationNotification(f.db, input));
    const lookup = f.calls[0];
    assert.match(lookup.sql, /c.status IN \('paid','refunded','disputed'\)/);
    assert.match(lookup.sql, /change.request_id/);
    assert.match(lookup.sql, /delivery.obligation_snapshot/);
    const queued = f.calls[1].values;
    assert.equal(
      queued[0],
      `sponsorship-obligation:fulfilled:${evidenceId}:${obligationId}:2`
    );
    assert.equal(queued[1], 'sponsorship_obligation');
    assert.equal(queued[2], 'synthetic@example.invalid');
    assert.match(
      queued[6],
      locale === 'en' ? /qualified evidence/ : /preuve qualifiée/
    );
    assert.match(queued[6], /https:\/\/example.invalid\/public-post/);
    assert.doesNotMatch(
      queued[6],
      /internal_reason|contact|approved_by|access_token|remboursé|payment confirmed/
    );
    assert.equal(JSON.parse(queued[8]).locale, locale);
  }
});
test('missing confirmed recipient leaves no queue record, and bad date or foreign evidence fails before insertion', async () => {
  let queries = 0;
  assert.equal(
    await enqueueSponsorshipObligationNotification(
      {
        query: async () => {
          queries++;
          return { rows: [] };
        }
      },
      input
    ),
    null
  );
  assert.equal(queries, 1);
  const f = fixture();
  await assert.rejects(
    enqueueSponsorshipObligationNotification(f.db, {
      ...input,
      eventId: '00000000-0000-4000-8000-000000000099'
    }),
    /EVIDENCE_MISMATCH/
  );
  assert.equal(f.calls.length, 1);
  await assert.rejects(
    enqueueSponsorshipObligationNotification(
      { query: () => assert.fail('invalid date is rejected before storage') },
      { ...input, event: 'date_approved', scheduledAt: 'invalid' }
    ),
    /INVALID/
  );
});
