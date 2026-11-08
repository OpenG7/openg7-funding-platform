import { createHash, randomUUID } from 'node:crypto';

import type {
  PreflightRehearsalRun,
  PreflightRehearsalScenario,
  PreflightRehearsalStep,
  PreflightRehearsalSummary,
  PreflightRehearsalOutput
} from '@openg7/funding-core';

import { PreflightClient, PreflightClientError } from './client.js';
import {
  PreflightContractError,
  record,
  text,
  uuid,
  type PreflightMission
} from './contracts.js';
import { projectInboxProposal } from './inbox.js';
import type { PreflightRehearsalConfig } from './rehearsal-config.js';
import type { RehearsalMissionDetail } from './rehearsal-contracts.js';
import {
  PreflightRehearsalStore,
  RehearsalError,
  type StoredRehearsal
} from './rehearsal-store.js';

type EnabledConfig = Extract<PreflightRehearsalConfig, { enabled: true }>;
type RehearsalClient = Pick<PreflightClient, 'submit' | 'getRehearsalMission'>;
const finishedStates = [
  'review_ready',
  'completed',
  'failed',
  'cancelled',
  'superseded',
  'waiting_input',
  'waiting_dependency'
];

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + stable(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

/** Only the dedicated recipe may send its fixed, zero-cost synthetic mission. */
export function createRehearsalFetch(
  config: EnabledConfig,
  fetcher: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const target = new URL(url),
      base = new URL(config.connection.baseUrl + '/api/missions');
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const oauth = url === config.connection.tokenUrl && method === 'POST';
    const api =
      target.origin === base.origin &&
      !target.search &&
      !target.hash &&
      !target.username &&
      !target.password;
    const read =
      api &&
      method === 'GET' &&
      new RegExp('^' + base.pathname + '/[0-9a-f-]{36}$', 'i').test(
        target.pathname
      );
    let submit = false;
    if (
      api &&
      method === 'POST' &&
      target.pathname === base.pathname &&
      typeof init?.body === 'string'
    ) {
      try {
        const body = record(JSON.parse(init.body));
        const source = record(body.source),
          workflow = record(body.workflow),
          constraints = record(body.constraints),
          missionInput = record(body.input);
        uuid(body.missionId);
        uuid(body.eventId);
        uuid(source.subjectId);
        submit =
          body.tenantId === config.connection.tenantId &&
          body.schemaVersion === '1.0' &&
          source.application === 'funding-platform' &&
          source.subjectType === 'sponsorship-commitment' &&
          source.version === 1 &&
          workflow.type === 'sponsorship-preparation-v1' &&
          workflow.version === '1.0' &&
          constraints.maxCostUsd === 0 &&
          constraints.humanApprovalRequired === true &&
          missionInput.preparationOnly === true &&
          missionInput.synthetic === true &&
          missionInput.rehearsal === true;
      } catch {
        submit = false;
      }
    }
    if (!oauth && !read && !submit)
      throw new PreflightClientError('preflight_rehearsal_request_forbidden');
    return fetcher(input, init);
  };
}

function audit(
  run: StoredRehearsal,
  actor: string,
  action: string,
  result: string,
  now: string
): void {
  if (run.audit.length >= 200)
    throw new RehearsalError('PREFLIGHT_REHEARSAL_AUDIT_LIMIT', 409);
  run.audit.push({
    at: now,
    actor,
    action,
    result,
    correlationId: run.view.id
  });
}

function steps(
  run: StoredRehearsal,
  detail?: RehearsalMissionDetail
): PreflightRehearsalStep[] {
  const view = run.view;
  const step = (
    key: PreflightRehearsalStep['key'],
    state: PreflightRehearsalStep['state'],
    at: string | null,
    code?: string
  ): PreflightRehearsalStep => ({ key, state, at, ...(code ? { code } : {}) });
  const started =
    detail?.telemetry.tasks
      .map((task) => task.startedAt)
      .filter((at): at is string => !!at)
      .sort()[0] ??
    view.steps.find((item) => item.key === 'processing')?.at ??
    null;
  const ready =
    detail?.telemetry.history.find((event) => event.to === 'review_ready')
      ?.createdAt ??
    (view.receivedAt
      ? view.steps.find((item) => item.key === 'prepared')?.at
      : null) ??
    null;
  const blocked = ['waiting_input', 'waiting_dependency'].includes(
    view.missionStatus ?? ''
  );
  const failed = ['failed', 'cancelled', 'superseded'].includes(
    view.missionStatus ?? ''
  );
  const invalid = view.error?.code === 'PREFLIGHT_REHEARSAL_RESPONSE_INVALID';
  const processingState = failed
    ? 'failed'
    : blocked
      ? 'attention'
      : view.receivedAt
        ? 'confirmed'
        : started
          ? 'active'
          : 'pending';
  return [
    step('created', 'confirmed', view.createdAt),
    step(
      'submitted',
      view.delivery === 'acknowledged'
        ? 'confirmed'
        : view.delivery === 'sending'
          ? 'active'
          : view.delivery === 'uncertain'
            ? 'attention'
            : view.delivery === 'rejected'
              ? 'failed'
              : 'pending',
      view.submittedAt,
      view.delivery === 'uncertain' ? view.error?.code : undefined
    ),
    step(
      'processing',
      processingState,
      started,
      failed
        ? view.error?.code
        : blocked
          ? 'PREFLIGHT_REHEARSAL_INPUT_REQUIRED'
          : undefined
    ),
    step(
      'prepared',
      view.receivedAt
        ? 'confirmed'
        : failed
          ? 'failed'
          : blocked || invalid
            ? 'attention'
            : 'pending',
      ready
    ),
    step(
      'returned',
      view.receivedAt ? 'confirmed' : invalid ? 'failed' : 'pending',
      view.receivedAt
    ),
    step(
      'review',
      view.receivedAt ? 'attention' : 'pending',
      view.receivedAt,
      view.receivedAt ? 'HUMAN_REVIEW_REQUIRED' : undefined
    )
  ];
}

function makeRun(
  config: EnabledConfig,
  id: string,
  scenario: PreflightRehearsalScenario,
  actor: string,
  now: string
): StoredRehearsal {
  const source = {
    application: 'funding-platform' as const,
    subjectType: 'sponsorship-commitment' as const,
    subjectId: randomUUID(),
    version: 1 as const
  };
  const fixture = {
    title: 'Dossier de recette synthétique Funding',
    description:
      'Préparation fictive pour vérifier la passerelle locale Funding–Preflight.',
    benefits: ['Proposition privée à examiner dans Funding.']
  };
  const digest = createHash('sha256').update(stable(fixture)).digest('hex');
  const missionId = randomUUID();
  const payload: PreflightMission = {
    schemaVersion: '1.0',
    missionId,
    eventId: randomUUID(),
    tenantId: config.connection.tenantId,
    source,
    workflow: { type: 'sponsorship-preparation-v1', version: '1.0' },
    priority: 'normal',
    constraints: {
      humanApprovalRequired: true,
      maxCostUsd: 0,
      timeoutMs: 30000,
      maxAttempts: 3
    },
    input: {
      ...fixture,
      ...(scenario === 'missing_input' ? { description: undefined } : {}),
      sourceSnapshotDigest: digest,
      sourceCommitmentVersion: 1,
      preparationOnly: true,
      synthetic: true,
      rehearsal: true
    }
  };
  if (scenario === 'missing_input') delete payload.input.description;
  const view: PreflightRehearsalRun = {
    id,
    scenario,
    synthetic: true,
    title: fixture.title,
    createdAt: now,
    updatedAt: now,
    source: { ...source, synthetic: true },
    missionId,
    missionStatus: null,
    delivery: 'prepared',
    submittedAt: null,
    lastCheckedAt: null,
    receivedAt: null,
    steps: [],
    tasks: [],
    proposals: [],
    output: null,
    error: null,
    expectedSimulation: true,
    observedSimulated: null,
    terminal: false,
    authority: 'source_application',
    businessDecisionExecuted: false
  };
  const run: StoredRehearsal = {
    schemaVersion: 1,
    tenantId: config.connection.tenantId,
    application: 'funding-platform',
    payload,
    correlationId: null,
    view,
    audit: []
  };
  run.view = { ...view, steps: steps(run) };
  audit(run, actor, 'created', 'persisted', now);
  return run;
}

function assertSnapshot(
  run: StoredRehearsal,
  detail: RehearsalMissionDetail
): void {
  const expected = run.payload,
    mission = detail.mission;
  if (
    mission.id !== expected.missionId ||
    stable(mission.source) !== stable(expected.source) ||
    stable(mission.workflow) !== stable(expected.workflow) ||
    stable(mission.input) !== stable(expected.input) ||
    (run.correlationId !== null &&
      run.correlationId !== detail.telemetry.correlationId)
  )
    throw new PreflightContractError('preflight_rehearsal_snapshot_mismatch');
}

/** Validates a recipe result against its own fixed input; this is not a business-source import. */
function returnedOutput(
  run: StoredRehearsal,
  detail: RehearsalMissionDetail
): PreflightRehearsalOutput {
  const required = [
    'completeness',
    'preparation-policy',
    'draft',
    'output-check'
  ];
  const selected = required.map((kind) => {
    const matches = detail.results.filter(
      (result) => result.kind === kind && !result.obsolete
    );
    if (matches.length !== 1) throw new PreflightContractError();
    return matches[0]!;
  });
  const [complete, policy, draft, check] = selected;
  if (
    !complete ||
    !policy ||
    !draft ||
    !check ||
    selected.some((item) => item.version !== draft.version) ||
    complete.output.complete !== true ||
    policy.output.businessDecisionAllowed !== false ||
    policy.output.externalPublicationAllowed !== false ||
    policy.output.humanReviewRequired !== true ||
    check.output.passed !== true ||
    check.output.sourceVersion !== 1 ||
    draft.provenance.inputVersion !== 1 ||
    draft.provenance.simulated !== true ||
    draft.provenance.estimatedCostUsd !== 0 ||
    draft.provenance.inputHash !==
      createHash('sha256')
        .update(JSON.stringify(detail.mission.input))
        .digest('hex') ||
    detail.proposals.length !== 1
  )
    throw new PreflightContractError();
  const proposal = detail.proposals[0]!;
  if (stable(record(proposal.provenance)) !== stable(draft.provenance))
    throw new PreflightContractError();
  const resultIds = proposal.resultIds;
  const proposalChecks = proposal.checks;
  if (
    proposal.status !== 'prepared' ||
    proposal.sourceVersion !== 1 ||
    proposal.draftResultId !== draft.id ||
    !Array.isArray(resultIds) ||
    resultIds.length !== 4 ||
    new Set(resultIds).size !== 4 ||
    selected.some((result) => !resultIds.includes(result.id))
  )
    throw new PreflightContractError();
  if (
    !Array.isArray(proposalChecks) ||
    proposalChecks.length !== 3 ||
    [complete, policy, check].some(
      (result) =>
        !proposalChecks.some((raw: unknown) => {
          const test = record(raw);
          return (
            test.resultId === result.id &&
            test.kind === result.kind &&
            test.passed === true
          );
        })
    )
  )
    throw new PreflightContractError();
  const output = draft.output;
  if (
    !Array.isArray(output.warnings) ||
    output.warnings.length > 50 ||
    output.warnings.some(
      (warning) => typeof warning !== 'string' || warning.length > 1000
    )
  )
    throw new PreflightContractError();
  if (
    run.payload.input.sourceSnapshotDigest !==
    detail.mission.input.sourceSnapshotDigest
  )
    throw new PreflightContractError();
  return {
    title: text(output.title, 200),
    summary: text(output.summary, 4000),
    body: text(output.body, 20000),
    warnings: output.warnings as string[],
    provenance: {
      provider: text(draft.provenance.provider),
      model: text(draft.provenance.model, 200),
      simulated: true
    }
  };
}

function failure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof PreflightContractError)
    return { code: 'PREFLIGHT_REHEARSAL_RESPONSE_INVALID', retryable: false };
  if (error instanceof PreflightClientError) {
    if (error.status === 404)
      return { code: 'PREFLIGHT_REHEARSAL_NOT_RECEIVED', retryable: true };
    if (error.status === 409 || error.status === 422)
      return { code: 'PREFLIGHT_REHEARSAL_REJECTED', retryable: false };
    if (
      [
        'preflight_submission_mismatch',
        'preflight_response_invalid',
        'preflight_mission_mismatch'
      ].includes(error.code)
    )
      return { code: 'PREFLIGHT_REHEARSAL_RESPONSE_INVALID', retryable: false };
  }
  return { code: 'PREFLIGHT_REHEARSAL_UNAVAILABLE', retryable: true };
}

export const rehearsalSummary = (
  run: PreflightRehearsalRun
): PreflightRehearsalSummary => ({
  id: run.id,
  scenario: run.scenario,
  title: run.title,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
  delivery: run.delivery,
  missionStatus: run.missionStatus,
  terminal: run.terminal
});

export class PreflightRehearsalService {
  readonly store: PreflightRehearsalStore;
  private readonly client: RehearsalClient;
  constructor(
    readonly config: EnabledConfig,
    options: {
      client?: RehearsalClient;
      store?: PreflightRehearsalStore;
      fetch?: typeof fetch;
      now?: () => string;
    } = {}
  ) {
    this.store =
      options.store ??
      new PreflightRehearsalStore(
        config.storageDir,
        config.connection.tenantId
      );
    this.client =
      options.client ??
      new PreflightClient(config.connection, {
        fetch: createRehearsalFetch(config, options.fetch)
      });
    this.now = options.now ?? (() => new Date().toISOString());
  }
  private readonly now: () => string;

  async list(): Promise<PreflightRehearsalSummary[]> {
    return (await this.store.list()).map((run) => rehearsalSummary(run.view));
  }

  async start(
    id: string,
    scenario: PreflightRehearsalScenario,
    actor: string
  ): Promise<PreflightRehearsalRun> {
    id = uuid(id).toLowerCase();
    return this.store.locked(id, async () => {
      const existing = await this.store.read(id);
      if (existing) {
        if (existing.view.scenario !== scenario)
          throw new RehearsalError(
            'PREFLIGHT_REHEARSAL_IDEMPOTENCY_CONFLICT',
            409
          );
        return existing.view;
      }
      const run = makeRun(this.config, id, scenario, actor, this.now());
      await this.store.create(run);
      await this.send(run, actor);
      return run.view;
    });
  }

  async observe(id: string, actor: string): Promise<PreflightRehearsalRun> {
    id = uuid(id).toLowerCase();
    return this.store.locked(id, async () => {
      const run = await this.required(id);
      await this.check(run, actor);
      return run.view;
    });
  }

  async resume(id: string, actor: string): Promise<PreflightRehearsalRun> {
    id = uuid(id).toLowerCase();
    return this.store.locked(id, async () => {
      const run = await this.required(id);
      audit(run, actor, 'resume', 'requested', this.now());
      const found = await this.check(run, actor);
      if (!found && run.view.error?.code === 'PREFLIGHT_REHEARSAL_NOT_RECEIVED')
        await this.send(run, actor);
      return run.view;
    });
  }

  private async required(id: string): Promise<StoredRehearsal> {
    const run = await this.store.read(id);
    if (!run) throw new RehearsalError('PREFLIGHT_REHEARSAL_NOT_FOUND', 404);
    return run;
  }

  private async send(run: StoredRehearsal, actor: string): Promise<void> {
    const now = this.now();
    run.view = {
      ...run.view,
      delivery: 'sending',
      error: null,
      terminal: false,
      updatedAt: now
    };
    run.view = { ...run.view, steps: steps(run) };
    audit(run, actor, 'submission', 'sending', now);
    await this.store.save(run);
    try {
      const accepted = await this.client.submit(run.payload);
      if (stable(accepted.mission.input) !== stable(run.payload.input))
        throw new PreflightContractError();
      run.view = {
        ...run.view,
        delivery: 'acknowledged',
        submittedAt: this.now(),
        missionStatus: accepted.mission.status,
        error: null
      };
      audit(run, actor, 'submission', 'acknowledged', this.now());
      await this.store.save(run);
      await this.check(run, actor);
    } catch (error) {
      if (error instanceof RehearsalError) throw error;
      const problem = failure(error);
      run.view = {
        ...run.view,
        delivery: problem.retryable ? 'uncertain' : 'rejected',
        error: problem,
        terminal: true,
        updatedAt: this.now(),
        proposals: [],
        output: null,
        receivedAt: null
      };
      run.view = { ...run.view, steps: steps(run) };
      audit(run, actor, 'submission', problem.code, this.now());
      await this.store.save(run);
    }
  }

  private async check(run: StoredRehearsal, actor: string): Promise<boolean> {
    try {
      const detail = await this.client.getRehearsalMission(run.view.missionId);
      assertSnapshot(run, detail);
      const now = this.now();
      const priorState = run.view.missionStatus,
        priorDelivery = run.view.delivery;
      run.correlationId = detail.telemetry.correlationId;
      const draft = detail.results.find(
        (result) => result.kind === 'draft' && !result.obsolete
      );
      const observed =
        typeof draft?.provenance.simulated === 'boolean'
          ? draft.provenance.simulated
          : run.view.observedSimulated;
      run.view = {
        ...run.view,
        delivery: 'acknowledged',
        submittedAt: run.view.submittedAt ?? detail.telemetry.createdAt,
        missionStatus: detail.mission.status,
        lastCheckedAt: now,
        updatedAt: now,
        tasks: detail.telemetry.tasks,
        error: null,
        terminal: finishedStates.includes(detail.mission.status),
        observedSimulated: observed,
        proposals: [],
        output: null,
        receivedAt: null
      };
      if (priorDelivery !== 'acknowledged')
        audit(run, actor, 'submission', 'reconciled', now);
      if (['review_ready', 'completed'].includes(detail.mission.status)) {
        const output = returnedOutput(run, detail);
        const proposal = detail.proposals[0]!;
        const projected = projectInboxProposal({
          ...proposal,
          status: 'prepared'
        });
        if (projected.provenance.simulated !== true)
          throw new PreflightContractError();
        const receivedAt =
          run.audit.find(
            (entry) =>
              entry.action === 'returned' && entry.result === 'verified'
          )?.at ?? now;
        run.view = {
          ...run.view,
          output,
          proposals: [projected],
          receivedAt,
          observedSimulated: true
        };
        if (
          !run.audit.some(
            (entry) =>
              entry.action === 'returned' && entry.result === 'verified'
          )
        )
          audit(run, actor, 'returned', 'verified', now);
      } else if (
        ['failed', 'cancelled', 'superseded'].includes(detail.mission.status)
      ) {
        run.view = {
          ...run.view,
          error: {
            code:
              detail.mission.status === 'superseded'
                ? 'PREFLIGHT_REHEARSAL_SOURCE_OBSOLETE'
                : detail.mission.status === 'cancelled'
                  ? 'PREFLIGHT_REHEARSAL_CANCELLED'
                  : detail.telemetry.errorCode === 'budget_exceeded'
                    ? 'PREFLIGHT_REHEARSAL_SIMULATION_REQUIRED'
                    : 'PREFLIGHT_REHEARSAL_PROCESSING_FAILED',
            retryable: false
          }
        };
      }
      run.view = { ...run.view, steps: steps(run, detail) };
      if (priorState !== detail.mission.status)
        audit(run, actor, 'observation', detail.mission.status, now);
      await this.store.save(run);
      return true;
    } catch (error) {
      if (error instanceof RehearsalError) throw error;
      const problem = failure(error),
        now = this.now();
      const sameError = run.view.error?.code === problem.code;
      const keepProof = problem.code === 'PREFLIGHT_REHEARSAL_UNAVAILABLE';
      run.view = {
        ...run.view,
        lastCheckedAt: now,
        updatedAt: now,
        error: problem,
        terminal: true,
        ...(run.view.delivery === 'sending' || run.view.delivery === 'prepared'
          ? { delivery: 'uncertain' as const }
          : {}),
        ...(keepProof ? {} : { proposals: [], output: null, receivedAt: null })
      };
      run.view = { ...run.view, steps: steps(run) };
      if (!sameError) audit(run, actor, 'observation', problem.code, now);
      await this.store.save(run);
      return false;
    }
  }
}
