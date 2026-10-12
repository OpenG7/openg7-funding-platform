import assert from 'node:assert/strict';
import test from 'node:test';
import { SponsorshipMediaUsageController } from '../dist/apps/funding-web/src/app/features/funding/services/sponsorship-media-usage-controller.js';
import { SponsorshipFollowupError } from '../dist/apps/funding-web/src/app/features/funding/models/sponsorship-followup-ui.js';
const usage = {
  state: 'confirmed',
  channels: ['website', 'facebook'],
  targets: ['openg7'],
  transformations: ['technical', 'portrait'],
  credit: 'Photo : Atelier synthétique',
  restrictions: null
};
const asset = {
  id: 'synthetic-photo',
  contributionId: 'synthetic-dossier',
  kind: 'supporting_image',
  version: 'asset-v1',
  usage
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture() {
  const calls = [],
    busy = [],
    state = {
      token: 'synthetic-private-link-A',
      assets: [asset],
      preference: { revision: 3 },
      fail: false,
      error: null,
      refreshes: 0,
      withdraw: true
    };
  const ports = {
    token: () => state.token,
    assets: () => state.assets,
    preference: () => state.preference,
    isBrowser: () => true,
    busyChange: (value) => busy.push(value),
    refresh: async () => {
      state.refreshes++;
    },
    confirmWithdrawal: () => state.withdraw,
    service: {
      updateSponsorshipMediaUsage: async (payload) => {
        calls.push(structuredClone(payload));
        if (state.error) throw state.error;
        if (state.fail) throw new Error('Synthetic unavailable');
        return { updated: true };
      },
      requestSponsorshipMediaPreference: async (payload) => {
        calls.push(structuredClone(payload));
        if (state.error) throw state.error;
        if (state.fail) throw new Error('Synthetic unavailable');
        return { updated: true };
      }
    }
  };
  return {
    controller: new SponsorshipMediaUsageController(ports),
    calls,
    busy,
    state,
    ports
  };
}
test('usage updates capture exact rights/asset version and refresh only after server confirmation', async () => {
  const f = fixture();
  await f.controller.updateUsage(asset, usage);
  assert.deepEqual(
    { ...f.calls[0], requestId: 'captured' },
    {
      token: f.state.token,
      assetId: asset.id,
      expectedVersion: 'asset-v1',
      requestId: 'captured',
      confirmed: true,
      usage
    }
  );
  assert.match(f.calls[0].requestId, /^[a-f0-9-]{36}$/);
  assert.equal(f.state.refreshes, 1);
  assert.equal(f.controller.pending(), null);
  assert.deepEqual(f.busy, [true, false]);
});
test('uncertain usage keeps the same UUID and exact payload; a changed grant cannot bypass verification', async () => {
  const f = fixture();
  f.state.fail = true;
  await f.controller.updateUsage(asset, usage);
  const first = f.calls[0];
  assert.equal(f.controller.notice(), 'mutationUnavailable');
  await f.controller.updateUsage(asset, { ...usage, credit: 'Another author' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.notice(), 'verificationRequired');
  f.state.fail = false;
  await f.controller.retry();
  assert.deepEqual(f.calls[1], first);
  assert.equal(f.state.refreshes, 1);
  assert.equal(f.controller.pending(), null);
});
test('a token change and reset discards late results from the previous dossier', async () => {
  const f = fixture(),
    waiting = deferred();
  f.ports.service.updateSponsorshipMediaUsage = () => waiting.promise;
  const saving = f.controller.updateUsage(asset, usage);
  assert.equal(f.controller.busy(), true);
  f.state.token = 'synthetic-private-link-B';
  f.controller.reset();
  waiting.resolve({ updated: true });
  await saving;
  assert.equal(f.state.refreshes, 0);
  assert.equal(f.controller.notice(), '');
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.pending(), null);
});
test('a definite version conflict refreshes the photo and permits a newly confirmed withdrawal with the current version', async () => {
  const f = fixture();
  f.state.error = new SponsorshipFollowupError(409, 'VERSION_CONFLICT');
  f.ports.refresh = async () => {
    f.state.refreshes++;
    f.state.assets = [{ ...asset, version: 'asset-v2' }];
  };
  await f.controller.withdraw(asset);
  const refused = f.calls[0];
  assert.equal(f.controller.notice(), 'versionConflict');
  assert.equal(f.controller.pending(), null);
  assert.equal(f.state.refreshes, 1);
  await f.controller.retry();
  await f.controller.withdraw(asset);
  assert.equal(f.calls.length, 1, 'the obsolete version cannot be resent');
  f.state.error = null;
  await f.controller.withdraw(f.state.assets[0]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].expectedVersion, 'asset-v2');
  assert.notEqual(f.calls[1].requestId, refused.requestId);
  assert.deepEqual(f.calls[1].usage, { ...usage, state: 'withdrawn' });
  assert.equal(f.controller.pending(), null);
  assert.equal(f.controller.notice(), 'saved');
});
test('a definite preference conflict refreshes the revision and permits a new choice without losing its correction', async () => {
  const f = fixture();
  f.controller.correction.set('Please use this exact photograph.');
  f.state.error = new SponsorshipFollowupError(409, 'VERSION_CONFLICT');
  f.ports.refresh = async () => {
    f.state.refreshes++;
    f.state.preference = { revision: 4 };
  };
  await f.controller.propose(asset);
  assert.equal(f.controller.pending(), null);
  assert.equal(f.controller.correction(), 'Please use this exact photograph.');
  assert.equal(f.controller.notice(), 'versionConflict');
  f.state.error = null;
  await f.controller.propose(asset);
  assert.deepEqual(
    f.calls.map((call) => call.expectedRevision),
    [3, 4]
  );
  assert.notEqual(f.calls[0].requestId, f.calls[1].requestId);
  assert.equal(f.calls[1].correction, f.calls[0].correction);
  assert.equal(f.controller.correction(), '');
});
test('a failed refresh after a confirmed refusal releases the command without pretending that fresh context was loaded', async () => {
  const f = fixture();
  f.state.error = new SponsorshipFollowupError(409, 'VERSION_CONFLICT');
  f.ports.refresh = async () => {
    throw new Error('Synthetic media read unavailable');
  };
  await f.controller.withdraw(asset);
  assert.equal(f.controller.notice(), 'versionConflict');
  assert.equal(f.controller.pending(), null);
  assert.equal(f.controller.busy(), false);
  await f.controller.retry();
  assert.equal(f.calls.length, 1);
  f.state.assets = [{ ...asset, version: 'asset-v2' }];
  f.state.error = null;
  f.ports.refresh = async () => undefined;
  await f.controller.withdraw(f.state.assets[0]);
  assert.equal(f.calls[1].expectedVersion, 'asset-v2');
  assert.notEqual(f.calls[1].requestId, f.calls[0].requestId);
});
test('a validation refusal permits correction while ambiguous or conflicting receipts retain the original command', async () => {
  const invalid = fixture();
  invalid.state.error = new SponsorshipFollowupError(
    400,
    'INVALID_MEDIA_USAGE_REQUEST'
  );
  await invalid.controller.updateUsage(asset, usage);
  assert.equal(invalid.controller.pending(), null);
  assert.equal(invalid.controller.notice(), 'mutationRejected');
  invalid.state.error = null;
  await invalid.controller.updateUsage(asset, {
    ...usage,
    credit: 'Corrected synthetic credit'
  });
  assert.notEqual(invalid.calls[0].requestId, invalid.calls[1].requestId);
  for (const error of [
    new SponsorshipFollowupError(503, 'MEDIA_USAGE_UNAVAILABLE'),
    new SponsorshipFollowupError(409, 'IDEMPOTENCY_CONFLICT'),
    new SponsorshipFollowupError(409, 'RECEIPT_UNCERTAIN'),
    new SponsorshipFollowupError(409),
    new SponsorshipFollowupError(401),
    new Error('Synthetic connection lost after commit')
  ]) {
    const f = fixture();
    f.state.error = error;
    await f.controller.withdraw(asset);
    const captured = f.calls[0];
    f.state.assets = [{ ...asset, version: 'asset-v2' }];
    await f.controller.withdraw(f.state.assets[0]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.controller.notice(), 'verificationRequired');
    await f.controller.retry();
    assert.deepEqual(f.calls[1], captured);
    assert.equal(f.controller.pending().payload.requestId, captured.requestId);
    f.state.error = null;
    await f.controller.retry();
    assert.deepEqual(f.calls[2], captured);
    assert.equal(f.controller.pending(), null);
  }
});
test('withdrawal requires confirmation and retains only this asset permission scope', async () => {
  const f = fixture();
  f.state.withdraw = false;
  await f.controller.withdraw(asset);
  assert.equal(f.calls.length, 0);
  f.state.withdraw = true;
  await f.controller.withdraw(asset);
  assert.deepEqual(f.calls[0].usage, { ...usage, state: 'withdrawn' });
  await f.controller.updateUsage({ ...asset, version: 'stale-version' }, usage);
  assert.equal(f.calls.length, 1);
});
test('owned photo preference sends current revision and correction once; foreign/logo selections are ignored', async () => {
  const f = fixture();
  f.controller.correction.set('Please use this exact photograph.');
  await f.controller.propose({ ...asset, id: 'foreign' });
  await f.controller.propose({ ...asset, kind: 'logo' });
  assert.equal(f.calls.length, 0);
  f.state.fail = true;
  await f.controller.propose(asset);
  const first = f.calls[0];
  assert.equal(first.expectedRevision, 3);
  assert.equal(first.assetId, asset.id);
  assert.equal(first.correction, 'Please use this exact photograph.');
  f.state.fail = false;
  await f.controller.retry();
  assert.deepEqual(f.calls[1], first);
  assert.equal(f.controller.correction(), '');
  assert.equal(f.state.refreshes, 1);
});
