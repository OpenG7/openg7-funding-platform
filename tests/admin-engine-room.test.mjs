import assert from 'node:assert/strict';
import test from 'node:test';
import { readEngineRoom } from '../dist/apps/funding-api/src/admin-engine-room.service.js';
import { createAdminEngineRoomHttpHandler } from '../dist/apps/funding-api/src/admin-engine-room.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import {
  engineFeedHealth,
  heartbeatState
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-engine-room-page/engine-room-view.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const date = '2026-11-23T12:00:00Z';
const now = () => new Date(date);
const state = () => ({
  workerEnabled: true,
  feeds: [
    { id: 'canada:facebook' },
    { id: 'canada:linkedin' },
    { id: 'openg7:facebook' }
  ],
  deliveries: [
    { id, feedId: 'canada:facebook', sponsors: [{ id }] },
    { id: other, feedId: 'openg7:facebook', sponsors: [{ id: other }] }
  ],
  queue: {
    entries: [
      { sponsorshipId: id, feedId: 'canada:linkedin' },
      { sponsorshipId: other, feedId: 'openg7:facebook' }
    ],
    hasMore: false
  }
});
const ports = (overrides = {}) => ({
  publications: async () => state(),
  connectorEnabled: false,
  localPreparationEnabled: false,
  connector: async () => {
    throw new Error('Disabled connectors must not be called');
  },
  ...overrides
});

test('global supervision preserves independent facts and does not probe a disabled connector', async () => {
  const result = await readEngineRoom(ports(), {}, now);
  assert.equal(result.publications.feeds.length, 3);
  assert.equal(result.publications.workerEnabled, true);
  assert.equal(result.preflight.connection, 'disabled');
  assert.equal(result.preflight.lastWorkerSeenAt, null);
  assert.equal(result.observedAt, now().toISOString());
});

test('dossier scope excludes unrelated publications and includes planned destinations', async () => {
  let requested;
  const result = await readEngineRoom(
    ports({
      publications: async (scope) => {
        requested = scope;
        return state();
      }
    }),
    { sponsorshipId: id },
    now
  );
  assert.deepEqual(requested, { sponsorshipId: id });
  assert.deepEqual(
    result.publications.deliveries.map((d) => d.id),
    [id]
  );
  assert.deepEqual(
    result.publications.feeds.map((f) => f.id),
    ['canada:facebook', 'canada:linkedin']
  );
});

test('publication scope cannot expand to the preparation queue or another dossier', async () => {
  const result = await readEngineRoom(ports(), { deliveryId: id }, now);
  assert.deepEqual(
    result.publications.feeds.map((f) => f.id),
    ['canada:facebook']
  );
  const absent = await readEngineRoom(
    ports(),
    { deliveryId: other, sponsorshipId: id },
    now
  );
  assert.equal(absent.publications.feeds.length, 0);
  assert.equal(absent.publications.deliveries.length, 0);
});

test('case-insensitive UUID input retains its exact dossier instead of producing a false empty state', async () => {
  const uuid = 'abcdefab-1111-4111-8111-111111111111';
  const result = await readEngineRoom(
    ports({
      publications: async () => ({
        ...state(),
        deliveries: [
          { id, feedId: 'canada:facebook', sponsors: [{ id: uuid }] }
        ]
      })
    }),
    { sponsorshipId: uuid.toUpperCase() },
    now
  );
  assert.equal(result.scope.sponsorshipId, uuid);
  assert.equal(result.publications.deliveries.length, 1);
});

test('partial publication failure does not hide connector evidence or expose private port fields', async () => {
  const result = await readEngineRoom(
    ports({
      publications: async () => {
        throw new Error('private upstream diagnostic');
      },
      connectorEnabled: true,
      connector: async () => ({
        lastWorkerSeenAt: date,
        pending: 2,
        quarantined: 1,
        quarantinedImports: 3,
        clientSecret: 'private-canary'
      })
    }),
    {},
    now
  );
  assert.equal(result.publications.available, false);
  assert.equal(result.publications.workerEnabled, null);
  assert.equal(result.preflight.connection, 'not_verified');
  assert.equal(result.preflight.quarantined, 4);
  assert.doesNotMatch(JSON.stringify(result), /private|clientSecret/);
});

test('connector read failure is not presented as remote health or a stopped publication engine', async () => {
  const result = await readEngineRoom(
    ports({ connectorEnabled: true }),
    {},
    now
  );
  assert.equal(result.publications.available, true);
  assert.equal(result.preflight.available, false);
  assert.equal(result.preflight.connection, 'unavailable');
  assert.equal(result.preflight.pending, null);
});

test('native limits and local preparation are explicit rather than invented completeness or remote activation', async () => {
  const result = await readEngineRoom(
    ports({
      localPreparationEnabled: true,
      publications: async () => ({
        ...state(),
        deliveries: Array.from({ length: 200 }, () => state().deliveries[0])
      })
    }),
    {},
    now
  );
  assert.equal(result.publications.partial, true);
  assert.equal(result.preflight.connectorEnabled, false);
  assert.equal(result.preflight.localPreparationEnabled, true);
});

const http = (allowed = true, read = async () => ({ observedAt: date })) => {
  const events = [];
  const handler = createAdminEngineRoomHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: () => {
      events.push('auth');
      return allowed;
    },
    read: async (scope) => {
      events.push(['read', scope]);
      return read(scope);
    },
    writeJson: (_req, res, status, body, headers) =>
      Object.assign(res, { status, body, headers })
  });
  return { handler, events };
};

test('engine room authorizes before reading and unrelated routes fall through', async () => {
  const { handler, events } = http(false);
  assert.equal(
    await handler({ url: '/api/admin/engine-room', method: 'GET' }, {}),
    true
  );
  assert.deepEqual(events, ['auth']);
  assert.equal(await handler({ url: '/health', method: 'GET' }, {}), false);
  assert.deepEqual(events, ['auth']);
});

test('engine room is read only even for an owner and never exposes raw errors', async () => {
  const { handler, events } = http(true, async () => {
    throw new Error('private-canary');
  });
  const mutation = {};
  await handler({ url: '/admin/engine-room', method: 'POST' }, mutation);
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.Allow, 'GET');
  assert.equal(events.length, 1);
  const response = {};
  await handler({ url: '/api/admin/engine-room', method: 'GET' }, response);
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(response), /private-canary/);
});

test('scope rejects unknown, repeated and invalid identifiers before calling owner reads', async () => {
  for (const query of [
    'sponsorshipId=invalid',
    'secret=anything',
    `deliveryId=${id}&deliveryId=${other}`,
    'sponsorshipId='
  ]) {
    const { handler, events } = http();
    const response = {};
    await handler(
      { url: '/api/admin/engine-room?' + query, method: 'GET' },
      response
    );
    assert.equal(response.status, 400, query);
    assert.deepEqual(events, ['auth']);
  }
});

test('authorized readers may inspect scoped engine facts and responses cannot be cached', async () => {
  assert.equal(
    adminRoleAllows('reader', 'GET', '/api/admin/engine-room'),
    true
  );
  const { handler, events } = http();
  const response = {};
  await handler(
    { url: '/api/admin/engine-room?sponsorshipId=' + id, method: 'GET' },
    response
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(events[1], ['read', { sponsorshipId: id }]);
});

test('account dimensions and heartbeat evidence cannot imply that a worker is operational', () => {
  const feed = {
    mode: 'mock',
    configured: true,
    connection: 'unchecked',
    paused: false
  };
  assert.equal(engineFeedHealth(feed), 'unchecked');
  assert.equal(
    engineFeedHealth({ ...feed, connection: 'ready', paused: true }),
    'paused'
  );
  assert.equal(engineFeedHealth({ ...feed, mode: 'disabled' }), 'disabled');
  assert.equal(heartbeatState(null, now().getTime()), 'unknown');
  assert.equal(heartbeatState('invalid', now().getTime()), 'unknown');
  assert.equal(heartbeatState(date, now().getTime()), 'recent');
  assert.equal(heartbeatState(date, now().getTime() + 46_000), 'stale');
  assert.equal(heartbeatState(date, now().getTime() - 1), 'unknown');
});
