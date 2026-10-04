import type { IncomingMessage } from 'node:http';

import type { AdminAuditLogInput } from '../fund-admin.repository.js';

import type { ReportFailure } from './contracts.js';

export interface AssistantAuditDependencies {
  readonly auditAvailable: boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly insertAdminAuditLog: (input: AdminAuditLogInput) => Promise<unknown>;
  readonly reportFailure: ReportFailure;
}

// Usage audit contains only the consultation metadata supplied by the handler,
// never the request or its free-text question. Failure must not block a response.
export const createAssistantAuditRecorder = ({
  auditAvailable,
  getAdminAuditActor,
  insertAdminAuditLog,
  reportFailure
}: AssistantAuditDependencies) => {
  return async (
    request: IncomingMessage,
    action: string,
    metadata: Record<string, unknown>
  ): Promise<void> => {
    if (!auditAvailable) {
      return;
    }
    try {
      await insertAdminAuditLog({
        actor: getAdminAuditActor(request),
        action,
        entityType: 'admin_assistant',
        entityId: null,
        summary: null,
        metadata
      });
    } catch (error) {
      reportFailure('Failed to record admin assistant audit.', error);
    }
  };
};
