import assert from 'node:assert/strict';
import test from 'node:test';

import { createLegacySponsorshipDetailsHttpHandler } from '../dist/apps/funding-api/src/legacy-sponsorship-details.http.js';

const fixture = () => {
  const responses = [];
  const handler = createLegacySponsorshipDetailsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    writeJson: (_request, _response, status, payload) =>
      responses.push({ status, payload })
  });
  return { handler, responses };
};

test('Both legacy aliases reject requests before reading the body or accessing a provider', async () => {
  for (const url of ['/sponsorship-details', '/api/sponsorship-details?x=1']) {
    const { handler, responses } = fixture();
    const request = {
      method: 'POST',
      url,
      headers: {},
      async *[Symbol.asyncIterator]() {
        throw new Error('A retired endpoint must not read or process a body.');
      }
    };
    assert.equal(await handler(request, {}), true);
    assert.deepEqual(responses, [
      {
        status: 410,
        payload: {
          code: 'SPONSORSHIP_LEGACY_ENDPOINT_RETIRED',
          error: 'Use the private sponsorship follow-up with its access token.'
        }
      }
    ]);
  }
});

test('Retirement does not intercept the token-protected follow-up or other routes', async () => {
  const { handler, responses } = fixture();
  for (const [method, url] of [
    ['GET', '/sponsorship-details'],
    ['POST', '/sponsorship-details/extra'],
    ['POST', '/sponsorship-followup/details'],
    ['POST', '/api/sponsorship-followup/details']
  ]) {
    assert.equal(await handler({ method, url }, {}), false);
  }
  assert.deepEqual(responses, []);
});
