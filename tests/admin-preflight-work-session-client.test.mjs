import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingAdminPreflightWorkSessionsClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-preflight-work-sessions.client.js';

function fixture() {
  let settle;
  const response = new Promise((resolve) => {
    settle = resolve;
  });
  const state = {
    identity: {
      id: 'synthetic-reviewer-a',
      sessionId: 'synthetic-session-a',
      role: 'operator'
    },
    generation: 7,
    cleared: 0
  };
  const session = {
    identity: () => state.identity,
    sessionGeneration: () => state.generation,
    requestAdminJson: async () => response
  };
  return {
    state,
    client: new FundingAdminPreflightWorkSessionsClient(session, () => {
      state.cleared++;
    }),
    unauthorized: () =>
      settle(
        new Response(JSON.stringify({ code: 'ADMIN_UNAUTHORIZED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      )
  };
}

for (const change of [
  { name: 'actor', value: { id: 'synthetic-reviewer-b' } },
  { name: 'cookie session', value: { sessionId: 'synthetic-session-b' } },
  { name: 'role', value: { role: 'reader' } }
]) {
  test(`a late 401 for another ${change.name} cannot clear the current identity when generation is unchanged`, async () => {
    const f = fixture();
    const pending = f.client.read();
    f.state.identity = { ...f.state.identity, ...change.value };
    f.unauthorized();
    await assert.rejects(pending, { status: 401, code: 'ADMIN_UNAUTHORIZED' });
    assert.equal(f.state.generation, 7);
    assert.equal(f.state.cleared, 0);
  });
}

test('a 401 for the same identity invalidates its current session', async () => {
  const f = fixture();
  const pending = f.client.read();
  f.unauthorized();
  await assert.rejects(pending, { status: 401, code: 'ADMIN_UNAUTHORIZED' });
  assert.equal(f.state.cleared, 1);
});
