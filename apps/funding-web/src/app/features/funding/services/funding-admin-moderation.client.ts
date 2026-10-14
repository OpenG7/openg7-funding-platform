import type {
  ModerationContent,
  ModerationDecisionInput,
  ModerationSubject,
  ModerationDecisionRecord
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

export type { ModerationContent } from '@openg7/funding-core';

/** Private administrative moderation transport; session and rights remain server-owned. */
export class FundingAdminModerationClient {
  constructor(private readonly session: FundingAdminSession) {}

  content(subject: ModerationSubject): Promise<ModerationContent> {
    const query = new URLSearchParams({
      subjectType: subject.type,
      subjectId: subject.id
    });
    return this.request(`/admin/moderation/content?${query}`);
  }

  decide(
    subject: ModerationSubject,
    decision: ModerationDecisionInput
  ): Promise<{ decision: ModerationDecisionRecord }> {
    return this.request('/admin/moderation/decisions', { subject, decision });
  }
  cases(subject: ModerationSubject): Promise<{
    items: {
      id: string;
      state: import('@openg7/funding-core').ModerationCaseState;
      currentDecisionId: string | null;
      assignedTo: string | null;
    }[];
  }> {
    return this.request(
      `/admin/moderation/cases?${new URLSearchParams({ subjectType: subject.type, subjectId: subject.id })}`
    );
  }
  decisions(subject: ModerationSubject): Promise<{
    items: (Omit<ModerationDecisionRecord, 'subject'> & {
      subjectType: ModerationSubject['type'];
      subjectId: string;
    })[];
  }> {
    return this.request(
      `/admin/moderation/decisions?${new URLSearchParams({ subjectType: subject.type, subjectId: subject.id })}`
    );
  }
  independentReview(
    decisionId: string,
    requestId: string
  ): Promise<{ decision: ModerationDecisionRecord }> {
    return this.request('/admin/moderation/independent-review', {
      decisionId,
      requestId,
      confirmation: decisionId
    });
  }

  reconsiderations(subject: ModerationSubject): Promise<{
    items: {
      id: string;
      decisionId: string;
      message: string;
      state: 'open' | 'resolved';
      createdAt: string;
      subjectType: ModerationSubject['type'];
      subjectId: string;
    }[];
  }> {
    return this.request(
      `/admin/moderation/reconsiderations?${new URLSearchParams({ subjectType: subject.type, subjectId: subject.id })}`
    );
  }
  resolveReconsideration(
    appealId: string,
    subject: ModerationSubject,
    decision: ModerationDecisionInput
  ): Promise<{ decision: ModerationDecisionRecord }> {
    return this.request('/admin/moderation/reconsiderations/resolve', {
      appealId,
      subject,
      decision
    });
  }
  assign(
    subject: ModerationSubject,
    assignedTo: string | null,
    expectedAssignedTo: string | null
  ): Promise<{ assignedTo: string | null }> {
    return this.request('/admin/moderation/assignment', {
      subject,
      assignedTo,
      expectedAssignedTo,
      confirmation: subject.id
    });
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.session.requestAdminJson(path, {
      auth: 'saved',
      cache: 'no-store',
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {})
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new AdminDashboardRequestError(
        response.status,
        data.code ?? 'MODERATION_UNAVAILABLE',
        data.code
      );
    }
    return response.json() as Promise<T>;
  }
}
