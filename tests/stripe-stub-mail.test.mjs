import assert from 'node:assert/strict';
import test from 'node:test';

import { listCapturedMail } from './stripe-stub/mail.mjs';

test('captured mailbox includes messages beyond the first page', async () => {
  const messages = Array.from({ length: 103 }, (_, index) => ({
    ID: String(index)
  }));
  const offsets = [];
  const result = await listCapturedMail(
    'http://mailpit.invalid',
    async (url) => {
      const start = Number(url.searchParams.get('start'));
      const limit = Number(url.searchParams.get('limit'));
      offsets.push(start);
      const page = messages.slice(start, start + limit);
      return Response.json({
        total: messages.length,
        count: page.length,
        start,
        messages: page
      });
    }
  );
  assert.deepEqual(offsets, [0, 50, 100]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { total: 103, count: 103, start: 0, messages });
});

test('captured mailbox does not report a partial result as success', async () => {
  assert.deepEqual(
    await listCapturedMail('http://mailpit.invalid', async () =>
      Response.json({ error: 'unavailable' }, { status: 503 })
    ),
    { status: 503, body: { error: 'unavailable' } }
  );
  await assert.rejects(
    listCapturedMail('http://mailpit.invalid', async () =>
      Response.json({ total: 1, count: 0, start: 0, messages: [] })
    ),
    /pagination stopped/
  );
});
