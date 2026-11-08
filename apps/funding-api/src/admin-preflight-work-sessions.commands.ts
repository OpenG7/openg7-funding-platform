import type {
  AdminPreflightWorkSessionCheckpoint,
  AdminPreflightWorkSessionCommandRequest,
  AdminPreflightWorkSessionFilters,
  AdminPreflightWorkSessionStartRequest,
  AdminServicePreparationSaveDraftRequest
} from '@openg7/funding-core';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';
import { isValidUuid } from './business-helpers/request-validation.js';

export function requireWorkSession(
  value: unknown,
  code = 'WORK_SESSION_INVALID_REQUEST',
  status = 400
): asserts value {
  if (!value) throw new AdminAutomaticRunError(code, status);
}
export const workVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const workRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) > 0 &&
  Number(value) < 2147483647;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  !value.includes('\0') &&
  !/[\uD800-\uDFFF]/u.test(value);
const object = (raw: unknown, keys: readonly string[]) => {
  requireWorkSession(raw && typeof raw === 'object' && !Array.isArray(raw));
  requireWorkSession(Object.keys(raw).every((key) => keys.includes(key)));
  return raw as Record<string, unknown>;
};
function filters(raw: unknown): AdminPreflightWorkSessionFilters {
  const data = object(raw, ['deskStatus', 'deskSearch', 'deskPage']);
  requireWorkSession(
    data.deskStatus === undefined ||
      (typeof data.deskStatus === 'string' &&
        ['all', 'to_prepare', 'to_review', 'to_deliver', 'delivered'].includes(
          data.deskStatus
        ))
  );
  requireWorkSession(
    data.deskSearch === undefined ||
      (text(data.deskSearch, 120) && !/[\x00-\x1f\x7f]/.test(data.deskSearch))
  );
  requireWorkSession(
    data.deskPage === undefined ||
      (Number.isSafeInteger(data.deskPage) &&
        Number(data.deskPage) > 0 &&
        Number(data.deskPage) <= 100000)
  );
  return {
    ...(data.deskStatus === undefined
      ? {}
      : {
          deskStatus:
            data.deskStatus as AdminPreflightWorkSessionFilters['deskStatus']
        }),
    ...(data.deskSearch === undefined
      ? {}
      : { deskSearch: (data.deskSearch as string).trim() }),
    ...(data.deskPage === undefined
      ? {}
      : { deskPage: data.deskPage as number })
  };
}
function checkpoint(raw: unknown): AdminPreflightWorkSessionCheckpoint {
  const data = object(raw, [
    'pendingDecision',
    'reason',
    'view',
    'decisionRequestId',
    'expectedPreparationVersion'
  ]);
  requireWorkSession(
    data.pendingDecision === null ||
      (typeof data.pendingDecision === 'string' &&
        ['approved', 'correction_requested', 'rejected'].includes(
          data.pendingDecision
        ))
  );
  requireWorkSession(text(data.reason, 2000));
  requireWorkSession(
    data.view === undefined ||
      (text(data.view, 40) && /^[a-z_-]+$/.test(data.view))
  );
  requireWorkSession(
    (data.decisionRequestId === undefined &&
      data.expectedPreparationVersion === undefined) ||
      (isValidUuid(data.decisionRequestId) &&
        workVersion(data.expectedPreparationVersion))
  );
  return {
    pendingDecision:
      data.pendingDecision as AdminPreflightWorkSessionCheckpoint['pendingDecision'],
    reason: data.reason,
    ...(data.view === undefined ? {} : { view: data.view as string }),
    ...(data.decisionRequestId === undefined
      ? {}
      : {
          decisionRequestId: (data.decisionRequestId as string).toLowerCase(),
          expectedPreparationVersion: data.expectedPreparationVersion as string
        })
  };
}
export function parseWorkSessionStart(
  raw: unknown
): AdminPreflightWorkSessionStartRequest {
  const data = object(raw, [
    'requestId',
    'contributionId',
    'obligationId',
    'filters'
  ]);
  requireWorkSession(
    isValidUuid(data.requestId) &&
      isValidUuid(data.contributionId) &&
      isValidUuid(data.obligationId)
  );
  return {
    requestId: (data.requestId as string).toLowerCase(),
    contributionId: (data.contributionId as string).toLowerCase(),
    obligationId: (data.obligationId as string).toLowerCase(),
    ...(data.filters === undefined ? {} : { filters: filters(data.filters) })
  };
}
export function parseWorkSessionCommand(
  raw: unknown
): AdminPreflightWorkSessionCommandRequest {
  const data = object(raw, [
    'requestId',
    'expectedRevision',
    'action',
    'contributionId',
    'obligationId',
    'observedVersion',
    'checkpoint',
    'filters'
  ]);
  requireWorkSession(
    isValidUuid(data.requestId) && workRevision(data.expectedRevision)
  );
  requireWorkSession(
    typeof data.action === 'string' &&
      ['visit', 'defer', 'checkpoint', 'pause', 'finish', 'resume'].includes(
        data.action
      )
  );
  requireWorkSession(
    (data.contributionId === undefined && data.obligationId === undefined) ||
      (isValidUuid(data.contributionId) && isValidUuid(data.obligationId))
  );
  requireWorkSession(
    data.action !== 'visit' || isValidUuid(data.contributionId)
  );
  requireWorkSession(
    data.observedVersion === undefined || workVersion(data.observedVersion)
  );
  return {
    requestId: (data.requestId as string).toLowerCase(),
    expectedRevision: data.expectedRevision as number,
    action: data.action as AdminPreflightWorkSessionCommandRequest['action'],
    ...(data.contributionId === undefined
      ? {}
      : {
          contributionId: (data.contributionId as string).toLowerCase(),
          obligationId: (data.obligationId as string).toLowerCase()
        }),
    ...(data.observedVersion === undefined
      ? {}
      : { observedVersion: data.observedVersion as string }),
    ...(data.checkpoint === undefined
      ? {}
      : { checkpoint: checkpoint(data.checkpoint) }),
    ...(data.filters === undefined ? {} : { filters: filters(data.filters) })
  };
}
export function parseServicePreparationSaveDraft(
  raw: unknown
): AdminServicePreparationSaveDraftRequest {
  const data = object(raw, [
    'contributionId',
    'obligationId',
    'expectedVersion',
    'requestId',
    'title',
    'body',
    'disclosureText',
    'workSessionId',
    'expectedSessionRevision'
  ]);
  requireWorkSession(
    isValidUuid(data.contributionId) &&
      isValidUuid(data.obligationId) &&
      isValidUuid(data.requestId) &&
      workVersion(data.expectedVersion)
  );
  requireWorkSession(
    text(data.title, 160) &&
      data.title.trim().length > 0 &&
      text(data.body, 2500) &&
      data.body.trim().length > 0 &&
      text(data.disclosureText, 300) &&
      data.disclosureText.trim().length > 0
  );
  requireWorkSession(
    (data.workSessionId === undefined &&
      data.expectedSessionRevision === undefined) ||
      (isValidUuid(data.workSessionId) &&
        workRevision(data.expectedSessionRevision))
  );
  return {
    contributionId: (data.contributionId as string).toLowerCase(),
    obligationId: (data.obligationId as string).toLowerCase(),
    requestId: (data.requestId as string).toLowerCase(),
    expectedVersion: data.expectedVersion as string,
    title: data.title.trim(),
    body: data.body.trim(),
    disclosureText: data.disclosureText.trim(),
    ...(data.workSessionId === undefined
      ? {}
      : {
          workSessionId: (data.workSessionId as string).toLowerCase(),
          expectedSessionRevision: data.expectedSessionRevision as number
        })
  };
}
