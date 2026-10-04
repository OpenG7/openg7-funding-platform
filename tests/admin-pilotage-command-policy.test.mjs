import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePilotCommand } from '../dist/apps/funding-api/src/admin-pilotage/command-policy.js';
import { PilotError as CommandPilotError } from '../dist/apps/funding-api/src/admin-pilotage/errors.js';
import {
  parsePilotCommand as parsePublicCommand,
  PilotError
} from '../dist/apps/funding-api/src/admin-pilotage.service.js';
import { pilotageVersion } from '../dist/apps/funding-api/src/admin-pilotage-version.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const sponsorId = '33333333-3333-4333-8333-333333333333';
const scheduledAt = '2099-10-04T12:00:00.000Z';
const command = (action = 'publication.approve', overrides = {}) => ({
  requestId,
  action,
  targetId,
  version: '1',
  confirmation: targetId,
  ...overrides
});
const feedCommand = (action, overrides = {}) =>
  command(action, {
    targetId: 'openg7:facebook',
    confirmation: 'openg7:facebook',
    ...overrides
  });
const editPayload = {
  message: '  Synthetic publication\nExact second line  ',
  scheduledAt,
  mediaId: null
};
function rejects(value, code = 'INVALID_COMMAND') {
  assert.throws(
    () => parsePublicCommand(value),
    (error) => {
      assert.ok(error instanceof PilotError);
      assert.equal(error.code, code);
      assert.equal(error.status, 400);
      return true;
    }
  );
}

test('the historical facade retains the extracted parser and its public error identity', () => {
  assert.equal(parsePublicCommand, parsePilotCommand);
  assert.equal(PilotError, CommandPilotError);
  rejects(command('sponsor.reject'), 'REASON_REQUIRED');
});

test('publication request fingerprints ignore key order and preserve exact content and sponsor order', () => {
  const original = command('publication.edit', {
    payload: {
      ...editPayload,
      editorialIntent: 'neutral',
      approveSponsors: [
        { id: sponsorId, version: 'dossier-v1' },
        { id: targetId, version: 'dossier-v2' }
      ]
    }
  });
  const reordered = {
    confirmation: original.confirmation,
    payload: {
      approveSponsors: [
        { version: 'dossier-v1', id: sponsorId },
        { version: 'dossier-v2', id: targetId }
      ],
      editorialIntent: 'neutral',
      mediaId: null,
      scheduledAt,
      message: editPayload.message
    },
    version: original.version,
    targetId,
    action: original.action,
    requestId
  };
  const parsed = parsePilotCommand(original);
  assert.equal(
    pilotageVersion(parsed),
    pilotageVersion(parsePilotCommand(reordered))
  );
  assert.equal(parsed.payload.message, editPayload.message);
  assert.equal(parsed.payload.scheduledAt, scheduledAt);
  assert.notEqual(parsed, original);
  assert.notEqual(parsed.payload, original.payload);
  assert.notEqual(
    parsed.payload.approveSponsors[0],
    original.payload.approveSponsors[0]
  );
  assert.notEqual(
    pilotageVersion(parsed),
    pilotageVersion(
      parsePilotCommand({
        ...original,
        payload: {
          ...original.payload,
          approveSponsors: [...original.payload.approveSponsors].reverse()
        }
      })
    )
  );
});

test('programme move fingerprints canonicalize each move without changing its schedule or order', () => {
  const original = feedCommand('programme.apply', {
    version: 'programme-fingerprint',
    payload: {
      moves: [
        { id: targetId, version: 1, scheduledAt },
        { id: sponsorId, version: 2, scheduledAt }
      ]
    }
  });
  const reordered = {
    ...original,
    payload: {
      moves: original.payload.moves.map((move) => ({
        scheduledAt: move.scheduledAt,
        version: move.version,
        id: move.id
      }))
    }
  };
  assert.deepEqual(
    parsePilotCommand(original).payload.moves,
    original.payload.moves
  );
  assert.equal(
    pilotageVersion(parsePilotCommand(original)),
    pilotageVersion(parsePilotCommand(reordered))
  );
  assert.notEqual(
    pilotageVersion(parsePilotCommand(original)),
    pilotageVersion(
      parsePilotCommand({
        ...original,
        payload: { moves: [...original.payload.moves].reverse() }
      })
    )
  );
});

test('supported commands retain their action-specific target formats', () => {
  const commands = [
    feedCommand('programme.apply', {
      payload: { moves: [{ id: targetId, version: 1, scheduledAt }] }
    }),
    feedCommand('editorial.preferences', { payload: { preferences: [] } }),
    command('publication.repair'),
    command('publication.approve'),
    command('publication.reject'),
    command('publication.edit', { payload: editPayload }),
    feedCommand('feed.pause'),
    feedCommand('feed.resume', {
      targetId: 'openg20:linkedin',
      confirmation: 'openg20:linkedin'
    }),
    command('sponsor.approve'),
    command('sponsor.reject', { payload: { reason: 'Synthetic review' } }),
    command('email.retry'),
    command('project.publish', { targetId: '42', confirmation: '42' }),
    command('project.hide', { targetId: '42', confirmation: '42' })
  ];
  for (const value of commands)
    assert.equal(parsePilotCommand(value).action, value.action);

  for (const value of [
    command('feed.pause'),
    feedCommand('publication.approve'),
    feedCommand('feed.resume', {
      targetId: 'openg8:linkedin',
      confirmation: 'openg8:linkedin'
    }),
    command('project.publish'),
    command('project.hide', { targetId: '042', confirmation: '042' }),
    command('project.publish', { targetId: '-1', confirmation: '-1' })
  ])
    rejects(value);
});

test('malformed request IDs, versions and confirmations remain client errors before payload validation', () => {
  for (const value of [
    null,
    'publication.approve',
    command('sponsor.reject', { requestId: 'synthetic-request' }),
    command('sponsor.reject', { version: '' }),
    command('sponsor.reject', { version: 'x'.repeat(101) }),
    command('sponsor.reject', { confirmation: ` ${targetId}` }),
    command('sponsor.reject', { payload: { unexpected: true } })
  ])
    rejects(value);
});

test('editorial payloads cannot be attached to another action or carry unknown intentions', () => {
  for (const value of [
    command('publication.approve', { payload: { preferences: [] } }),
    command('publication.approve', { payload: { moves: [] } }),
    command('publication.approve', { payload: { editorialIntent: 'neutral' } }),
    command('publication.edit', {
      payload: { ...editPayload, editorialIntent: 'unknown' }
    }),
    feedCommand('editorial.preferences', {
      version: '01',
      payload: { preferences: [] }
    }),
    feedCommand('editorial.preferences', {
      payload: { preferences: ['unknown'] }
    }),
    feedCommand('editorial.preferences', {
      payload: {
        preferences: [
          'concise',
          'neutral',
          'project_first',
          'linkedin',
          'concise'
        ]
      }
    })
  ])
    rejects(value);

  assert.deepEqual(
    parsePilotCommand(
      feedCommand('editorial.preferences', {
        payload: { preferences: ['linkedin', 'neutral'] }
      })
    ).payload.preferences,
    ['linkedin', 'neutral']
  );
});

test('programme moves require a nonempty bounded list of versioned proposals', () => {
  const move = { id: targetId, version: 1, scheduledAt };
  for (const moves of [
    [],
    Array(101).fill(move),
    [null],
    [{ ...move, version: 0 }],
    [{ ...move, version: 1.5 }],
    [{ ...move, version: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...move, id: 'unknown' }],
    [{ ...move, scheduledAt: 'x'.repeat(41) }],
    [{ ...move, title: 'Display metadata' }]
  ])
    rejects(feedCommand('programme.apply', { payload: { moves } }));
});

test('publication edits require content, a schedule and an explicit media choice', () => {
  for (const payload of [
    { ...editPayload, message: ' \n ' },
    { ...editPayload, message: 'x'.repeat(2901) },
    { ...editPayload, scheduledAt: undefined },
    { ...editPayload, mediaId: undefined },
    { ...editPayload, mediaId: 'unknown' }
  ])
    rejects(command('publication.edit', { payload }));

  assert.equal(
    parsePilotCommand(
      command('publication.edit', {
        payload: { ...editPayload, mediaId: sponsorId }
      })
    ).payload.mediaId,
    sponsorId
  );
});

test('sponsor rejection preserves its reason error after envelope and payload checks', () => {
  for (const payload of [
    undefined,
    {},
    { reason: '  ' },
    { reason: 'ab' },
    { reason: 'x'.repeat(501) }
  ])
    rejects(command('sponsor.reject', { payload }), 'REASON_REQUIRED');

  rejects(command('sponsor.reject', { payload: { moves: [] } }));
  rejects(command('sponsor.reject', { payload: { approveSponsors: [null] } }));
  assert.equal(
    parsePilotCommand(
      command('sponsor.reject', { payload: { reason: '  Synthetic review  ' } })
    ).payload.reason,
    '  Synthetic review  '
  );
});
