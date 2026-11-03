import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

export interface PreflightPreparationView {
  readonly status: 'proposed';
  readonly missionId: string;
  readonly proposalId: string;
  readonly commitmentId: string;
  readonly sourceVersion: number;
  readonly sourceHash: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly warnings: readonly string[];
  readonly blockingConditions: readonly string[];
  readonly obsolete: boolean;
  readonly importedAt: string;
  readonly provenance: {
    readonly provider: string;
    readonly model: string;
    readonly simulated: boolean;
    readonly generatedAt: string;
    readonly estimatedCostUsd: number;
  };
}
export interface PreflightPreparationsView {
  readonly enabled: boolean;
  readonly connectionState: 'disabled' | 'not_verified';
  readonly items: readonly PreflightPreparationView[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Uses the existing human Funding session; technical connector credentials never reach the browser. */
export class FundingAdminPreflightClient {
  constructor(
    private readonly session: Pick<FundingAdminSession, 'requestAdminJson'>
  ) {}
  async read(contributionId: string): Promise<PreflightPreparationsView> {
    const query = new URLSearchParams({ sponsorshipId: contributionId });
    const response = await this.session.requestAdminJson(
      `/admin/preflight/preparations?${query}`,
      { auth: 'saved', cache: 'no-store' }
    );
    if (!response.ok)
      throw new AdminDashboardRequestError(
        response.status,
        'Preflight preparations unavailable.',
        'PREFLIGHT_UNAVAILABLE'
      );
    const raw: unknown = await response.json();
    if (
      !object(raw) ||
      typeof raw.enabled !== 'boolean' ||
      !['disabled', 'not_verified'].includes(raw.connectionState as string) ||
      !Array.isArray(raw.items)
    )
      throw new AdminDashboardRequestError(
        502,
        'Invalid Preflight preparation response.',
        'PREFLIGHT_RESPONSE_INVALID'
      );
    for (const item of raw.items) {
      if (
        !object(item) ||
        item.status !== 'proposed' ||
        item.businessDecisionExecuted !== false ||
        typeof item.obsolete !== 'boolean' ||
        ![
          'missionId',
          'proposalId',
          'commitmentId',
          'sourceHash',
          'title',
          'summary',
          'body',
          'importedAt'
        ].every((key) => typeof item[key] === 'string') ||
        !Number.isSafeInteger(item.sourceVersion) ||
        (item.sourceVersion as number) < 1 ||
        !Array.isArray(item.warnings) ||
        item.warnings.some((value) => typeof value !== 'string') ||
        !Array.isArray(item.blockingConditions) ||
        item.blockingConditions.some((value) => typeof value !== 'string') ||
        !object(item.provenance) ||
        typeof item.provenance.simulated !== 'boolean' ||
        !['provider', 'model', 'generatedAt'].every(
          (key) =>
            typeof (item.provenance as Record<string, unknown>)[key] ===
            'string'
        ) ||
        typeof item.provenance.estimatedCostUsd !== 'number'
      ) {
        throw new AdminDashboardRequestError(
          502,
          'Invalid Preflight preparation response.',
          'PREFLIGHT_RESPONSE_INVALID'
        );
      }
    }
    return raw as unknown as PreflightPreparationsView;
  }
}
