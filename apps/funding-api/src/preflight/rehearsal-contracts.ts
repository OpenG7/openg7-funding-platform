import type { PreflightRehearsalTask } from '@openg7/funding-core';

import {
  integer,
  parseRemoteMissionDetail,
  record,
  remoteMissionStates,
  text,
  uuid,
  PreflightContractError,
  type RemoteMissionDetail
} from './contracts.js';

export interface RehearsalMissionDetail extends RemoteMissionDetail {
  telemetry: {
    createdAt: string;
    updatedAt: string;
    correlationId: string;
    errorCode: string | null;
    tasks: PreflightRehearsalTask[];
    history: { action: string; to: string | null; createdAt: string }[];
  };
}

export function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new PreflightContractError();
  return new Date(value).toISOString();
}

export function safeCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(value))
    throw new PreflightContractError();
  return value;
}

/** The recipe observes the existing public telemetry, without changing the durable connector parser. */
export function parseRehearsalMissionDetail(
  raw: unknown,
  tenantId: string
): RehearsalMissionDetail {
  const detail = parseRemoteMissionDetail(raw, tenantId);
  const value = record(raw);
  const mission = record(value.mission);
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length > 50 ||
    !Array.isArray(value.history) ||
    value.history.length > 1000
  )
    throw new PreflightContractError();
  const correlationId = uuid(mission.correlationId);
  const taskStates = [
    'pending',
    'ready',
    'running',
    'waiting_input',
    'waiting_dependency',
    'completed',
    'failed',
    'cancelled',
    'superseded',
    'quarantined'
  ];
  return {
    ...detail,
    telemetry: {
      createdAt: timestamp(mission.createdAt),
      updatedAt: timestamp(mission.updatedAt),
      correlationId,
      errorCode: safeCode(mission.errorCode),
      tasks: value.tasks.map((rawTask) => {
        const task = record(rawTask);
        if (!taskStates.includes(task.status as string))
          throw new PreflightContractError();
        const attempts = integer(task.attempts, 0);
        if (attempts > 5) throw new PreflightContractError();
        return {
          id: uuid(task.id),
          key: text(task.key),
          kind: text(task.kind),
          status: task.status as string,
          attempts,
          startedAt: task.startedAt === null ? null : timestamp(task.startedAt),
          finishedAt:
            task.finishedAt === null ? null : timestamp(task.finishedAt),
          errorCode: safeCode(task.errorCode)
        };
      }),
      history: value.history.map((rawEvent) => {
        const event = record(rawEvent);
        if (event.correlationId !== correlationId)
          throw new PreflightContractError('preflight_correlation_mismatch');
        const data = record(event.data);
        const to = event.action === 'mission.transition' ? text(data.to) : null;
        if (to && !(remoteMissionStates as readonly string[]).includes(to))
          throw new PreflightContractError();
        return {
          action: text(event.action),
          to,
          createdAt: timestamp(event.createdAt)
        };
      })
    }
  };
}
