import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  ModerationDecisionInput,
  ModerationAssignmentRequest,
  ModerationSubject
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { isModerationSubject } from '../../../../packages/funding-core/src/index.js';
import { isJsonContentType } from '../http-routing.js';
import type { createHttpTransport, readBody } from '../http-transport.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import { getModerationContent } from './content.js';
import { assignModerationCase } from './assignment.js';
import { assistModerationContent } from './assistance.js';
import {
  moderationMetrics,
  moderationAdoptionPreview,
  moderationRetentionPreview
} from './governance.js';
import { ModerationError } from './policy.js';
import {
  confirmModerationDecision,
  recordModerationDecision
} from './repository.js';
import {
  listAdminModerationCases,
  listAdminModerationDecisions,
  listAdminModerationRemoteRemovals
} from './reads.js';
import {
  listAdminModerationReconsiderations,
  resolveModerationReconsideration
} from './reconsiderations.js';

export interface AdminModerationHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly pool: Pool | null;
  readonly readBody: typeof readBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ) => boolean;
  /** Proofs and internal reasons are never available to a reader, including GET. */
  readonly canReview: (request: IncomingMessage) => boolean;
  readonly canOwn: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
}

export function createAdminModerationHttpHandler(
  deps: AdminModerationHttpDependencies
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (
      ![
        '/admin/moderation/content',
        '/admin/moderation/assistance',
        '/admin/moderation/assignment',
        '/admin/moderation/cases',
        '/admin/moderation/decisions',
        '/admin/moderation/independent-review',
        '/admin/moderation/reconsiderations',
        '/admin/moderation/reconsiderations/resolve',
        '/admin/moderation/metrics',
        '/admin/moderation/adoption-preview',
        '/admin/moderation/retention-preview',
        '/admin/moderation/remote-removals'
      ].includes(path)
    )
      return false;
    response.setHeader('Cache-Control', 'no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (!deps.canReview(request)) {
      deps.writeJson(request, response, 403, {
        code: 'MODERATION_REVIEWER_REQUIRED',
        error: 'An authorized reviewer is required.'
      });
      return true;
    }
    if (
      [
        '/admin/moderation/adoption-preview',
        '/admin/moderation/retention-preview',
        '/admin/moderation/assignment'
      ].includes(path) &&
      !deps.canOwn(request)
    ) {
      deps.writeJson(request, response, 403, {
        code: 'MODERATION_OWNER_REQUIRED',
        error: 'The account owner is required.'
      });
      return true;
    }
    if (!deps.pool) {
      deps.writeJson(request, response, 503, {
        code: 'MODERATION_UNAVAILABLE',
        error: 'Moderation storage is unavailable.'
      });
      return true;
    }
    try {
      if (
        request.method === 'GET' &&
        [
          '/admin/moderation/metrics',
          '/admin/moderation/adoption-preview',
          '/admin/moderation/retention-preview',
          '/admin/moderation/remote-removals'
        ].includes(path)
      ) {
        const result = await withPostgresTransaction<unknown>(
          deps.pool,
          (db) =>
            path === '/admin/moderation/metrics'
              ? moderationMetrics(db)
              : path === '/admin/moderation/adoption-preview'
                ? moderationAdoptionPreview(db)
                : path === '/admin/moderation/retention-preview'
                  ? moderationRetentionPreview(db)
                  : listAdminModerationRemoteRemovals(db)
        );
        deps.writeJson(request, response, 200, result);
      } else if (
        request.method === 'GET' &&
        [
          '/admin/moderation/content',
          '/admin/moderation/assistance',
          '/admin/moderation/cases',
          '/admin/moderation/decisions',
          '/admin/moderation/reconsiderations'
        ].includes(path)
      ) {
        const subject =
          url.searchParams.has('subjectType') ||
          url.searchParams.has('subjectId')
            ? {
                type: url.searchParams.get('subjectType'),
                id: url.searchParams.get('subjectId')
              }
            : null;
        if (
          (subject && !isModerationSubject(subject)) ||
          (!subject &&
            [
              '/admin/moderation/content',
              '/admin/moderation/assistance'
            ].includes(path))
        )
          throw new ModerationError('INVALID_MODERATION_SUBJECT', 400);
        const result = await withPostgresTransaction<unknown>(
          deps.pool,
          (db) =>
            path === '/admin/moderation/content'
              ? getModerationContent(db, subject as ModerationSubject)
              : path === '/admin/moderation/assistance'
                ? assistModerationContent(db, subject as ModerationSubject)
                : path === '/admin/moderation/cases'
                  ? listAdminModerationCases(
                      db,
                      subject as ModerationSubject | null
                    )
                  : path === '/admin/moderation/reconsiderations'
                    ? listAdminModerationReconsiderations(
                        db,
                        subject as ModerationSubject | null
                      )
                    : listAdminModerationDecisions(
                        db,
                        subject as ModerationSubject | null
                      )
        );
        response.setHeader('Cache-Control', 'no-store');
        deps.writeJson(request, response, 200, result);
      } else if (
        request.method === 'POST' &&
        [
          '/admin/moderation/decisions',
          '/admin/moderation/assignment',
          '/admin/moderation/independent-review',
          '/admin/moderation/reconsiderations/resolve'
        ].includes(path)
      ) {
        if (!isJsonContentType(request.headers['content-type']))
          throw new ModerationError('JSON_REQUIRED', 415);
        const input = JSON.parse(await deps.readBody(request, 16 * 1024));
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new ModerationError('INVALID_MODERATION_DECISION', 400);
        const actor = deps.getAdminAuditActor(request);
        const result = await withPostgresTransaction<unknown>(
          deps.pool,
          (db) => {
            if (path === '/admin/moderation/assignment') {
              if (
                Object.keys(input).some(
                  (key) =>
                    ![
                      'subject',
                      'assignedTo',
                      'expectedAssignedTo',
                      'confirmation'
                    ].includes(key)
                )
              )
                throw new ModerationError('INVALID_MODERATION_ASSIGNEE', 400);
              return assignModerationCase(
                db,
                input as ModerationAssignmentRequest,
                actor
              );
            }
            if (path === '/admin/moderation/independent-review') {
              if (
                Object.keys(input).some(
                  (key) =>
                    !['decisionId', 'requestId', 'confirmation'].includes(key)
                )
              )
                throw new ModerationError('INVALID_MODERATION_DECISION', 400);
              return confirmModerationDecision(db, {
                decisionId: input.decisionId,
                requestId: input.requestId,
                confirmation: input.confirmation,
                actor
              });
            }
            if (path === '/admin/moderation/reconsiderations/resolve') {
              if (
                Object.keys(input).some(
                  (key) => !['appealId', 'subject', 'decision'].includes(key)
                ) ||
                !isModerationSubject(input.subject)
              )
                throw new ModerationError('INVALID_MODERATION_SUBJECT', 400);
              return resolveModerationReconsideration(db, {
                appealId: input.appealId,
                subject: input.subject,
                decision: input.decision,
                actor
              });
            }
            if (
              Object.keys(input).some(
                (key) => !['subject', 'decision'].includes(key)
              ) ||
              !isModerationSubject(input.subject)
            )
              throw new ModerationError('INVALID_MODERATION_SUBJECT', 400);
            return recordModerationDecision(db, {
              subject: input.subject,
              decision: input.decision as ModerationDecisionInput,
              actor
            });
          }
        );
        deps.writeJson(
          request,
          response,
          200,
          path === '/admin/moderation/assignment'
            ? result
            : { decision: result }
        );
      } else {
        deps.writeJson(request, response, 405, {
          code: 'METHOD_NOT_ALLOWED',
          error: 'Method is not allowed.'
        });
      }
    } catch (error) {
      deps.writeJson(
        request,
        response,
        error instanceof ModerationError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 503,
        {
          code:
            error instanceof ModerationError
              ? error.code
              : error instanceof SyntaxError
                ? 'INVALID_MODERATION_DECISION'
                : 'MODERATION_UNAVAILABLE',
          error: 'The moderation operation could not be completed.'
        }
      );
    }
    return true;
  };
}
