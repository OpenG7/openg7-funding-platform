import {
  EDITORIAL_INTENTS,
  type PilotAction,
  type PilotCommand
} from '../../../../packages/funding-core/src/index.js';
import { validId } from '../publication-automation/policy.js';

import { requireValue } from './errors.js';

const actions: PilotAction[] = [
  'programme.apply',
  'editorial.preferences',
  'publication.repair',
  'publication.approve',
  'publication.reject',
  'publication.edit',
  'feed.pause',
  'feed.resume',
  'sponsor.approve',
  'sponsor.reject',
  'email.retry',
  'project.publish',
  'project.hide'
];

export function parsePilotCommand(value: unknown): PilotCommand {
  requireValue(value && typeof value === 'object', 'INVALID_COMMAND', 400);
  const c = value as PilotCommand;
  requireValue(
    Object.keys(c).every((k) =>
      [
        'requestId',
        'action',
        'targetId',
        'version',
        'confirmation',
        'payload'
      ].includes(k)
    ),
    'INVALID_COMMAND',
    400
  );
  requireValue(
    validId(c.requestId) &&
      actions.includes(c.action) &&
      typeof c.targetId === 'string' &&
      c.targetId.length <= 100 &&
      typeof c.version === 'string' &&
      c.version.length > 0 &&
      c.version.length <= 100 &&
      c.confirmation === c.targetId,
    'INVALID_COMMAND',
    400
  );
  if (
    c.action.startsWith('feed.') ||
    c.action === 'programme.apply' ||
    c.action === 'editorial.preferences'
  )
    requireValue(
      /^openg(?:7|20):(facebook|linkedin)$/.test(c.targetId),
      'INVALID_COMMAND',
      400
    );
  else if (c.action.startsWith('project.'))
    requireValue(/^[1-9]\d{0,15}$/.test(c.targetId), 'INVALID_COMMAND', 400);
  else requireValue(validId(c.targetId), 'INVALID_COMMAND', 400);
  if (c.payload !== undefined)
    requireValue(
      c.payload &&
        typeof c.payload === 'object' &&
        !Array.isArray(c.payload) &&
        Object.keys(c.payload).every((k) =>
          [
            'message',
            'scheduledAt',
            'mediaId',
            'approveSponsors',
            'reason',
            'editorialIntent',
            'preferences',
            'moves'
          ].includes(k)
        ),
      'INVALID_COMMAND',
      400
    );
  if (c.payload?.editorialIntent !== undefined)
    requireValue(
      c.action === 'publication.edit' &&
        EDITORIAL_INTENTS.includes(c.payload.editorialIntent),
      'INVALID_COMMAND',
      400
    );
  if (c.payload?.moves !== undefined)
    requireValue(c.action === 'programme.apply', 'INVALID_COMMAND', 400);
  if (c.payload?.preferences !== undefined)
    requireValue(c.action === 'editorial.preferences', 'INVALID_COMMAND', 400);
  if (c.action === 'editorial.preferences')
    requireValue(
      /^[1-9]\d{0,8}$/.test(c.version) &&
        Array.isArray(c.payload?.preferences) &&
        c.payload.preferences.length <= 4 &&
        c.payload.preferences.every((p) => EDITORIAL_INTENTS.includes(p)),
      'INVALID_COMMAND',
      400
    );
  if (c.action === 'programme.apply')
    requireValue(
      Array.isArray(c.payload?.moves) &&
        c.payload.moves.length > 0 &&
        c.payload.moves.length <= 100 &&
        c.payload.moves.every(
          (m) =>
            m &&
            Object.keys(m).every((k) =>
              ['id', 'version', 'scheduledAt'].includes(k)
            ) &&
            validId(m.id) &&
            Number.isSafeInteger(m.version) &&
            m.version > 0 &&
            typeof m.scheduledAt === 'string' &&
            m.scheduledAt.length <= 40
        ),
      'INVALID_COMMAND',
      400
    );
  if (c.payload?.approveSponsors !== undefined)
    requireValue(
      Array.isArray(c.payload.approveSponsors) &&
        c.payload.approveSponsors.length <= 100 &&
        c.payload.approveSponsors.every(
          (s) =>
            s &&
            validId(s.id) &&
            typeof s.version === 'string' &&
            s.version.length > 0 &&
            s.version.length <= 100
        ),
      'INVALID_COMMAND',
      400
    );
  if (c.action === 'publication.edit')
    requireValue(
      typeof c.payload?.message === 'string' &&
        c.payload.message.trim().length > 0 &&
        c.payload.message.length <= 2900 &&
        typeof c.payload.scheduledAt === 'string' &&
        (c.payload.mediaId === null || validId(c.payload.mediaId)),
      'INVALID_COMMAND',
      400
    );
  if (c.action === 'sponsor.reject')
    requireValue(
      typeof c.payload?.reason === 'string' &&
        c.payload.reason.trim().length >= 3 &&
        c.payload.reason.length <= 500,
      'REASON_REQUIRED',
      400
    );
  // Canonicalize object key order without storing the private payload in a receipt.
  return {
    requestId: c.requestId,
    action: c.action,
    targetId: c.targetId,
    version: c.version,
    confirmation: c.confirmation,
    ...(c.payload
      ? {
          payload: {
            message: c.payload.message,
            scheduledAt: c.payload.scheduledAt,
            mediaId: c.payload.mediaId,
            approveSponsors: c.payload.approveSponsors?.map((s) => ({
              id: s.id,
              version: s.version
            })),
            reason: c.payload.reason,
            editorialIntent: c.payload.editorialIntent,
            preferences: c.payload.preferences,
            moves: c.payload.moves?.map((m) => ({
              id: m.id,
              version: m.version,
              scheduledAt: m.scheduledAt
            }))
          }
        }
      : {})
  };
}
