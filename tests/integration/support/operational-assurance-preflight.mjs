import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { PreflightRehearsalService } from '../../../dist/apps/funding-api/src/preflight/rehearsal.js';
import { loadPreflightRehearsalConfig } from '../../../dist/apps/funding-api/src/preflight/rehearsal-config.js';
import { PreflightClientError } from '../../../dist/apps/funding-api/src/preflight/client.js';

/** Injected local double only: no real token exchange, remote producer or paid model. */
export async function assurePreflightReconciliation(
  storageDir,
  { unavailableTransport = false } = {}
) {
  const config = loadPreflightRehearsalConfig({
    FUNDING_PLATFORM_ENV: 'test',
    FUNDING_PUBLIC_BASE_URL: 'https://funding.assurance.test',
    PREFLIGHT_REHEARSAL_ENABLED: 'true',
    PREFLIGHT_REHEARSAL_STORAGE_DIR: storageDir,
    PREFLIGHT_URL: 'https://preflight.assurance.test',
    PREFLIGHT_TOKEN_URL: 'https://identity.assurance.test/token',
    PREFLIGHT_TENANT_ID: 'synthetic-assurance',
    PREFLIGHT_CLIENT_ID: 'synthetic-assurance',
    PREFLIGHT_CLIENT_SECRET: randomUUID()
  });
  let submissions = 0,
    reads = 0,
    unavailable = false,
    absent = false,
    drop = true,
    detail = null;
  const payloads = [];
  const client = {
    async submit(payload) {
      submissions++;
      payloads.push(structuredClone(payload));
      assert.equal(payload.constraints.maxCostUsd, 0);
      assert.equal(payload.constraints.humanApprovalRequired, true);
      assert.equal(payload.input.synthetic, true);
      assert.equal(payload.input.rehearsal, true);
      assert.equal(payload.input.preparationOnly, true);
      const at = new Date().toISOString();
      if (!absent)
        detail = {
          mission: {
            id: payload.missionId,
            tenantId: payload.tenantId,
            source: payload.source,
            workflow: payload.workflow,
            input: payload.input,
            status: 'waiting_input',
            revision: 1
          },
          results: [],
          proposals: [],
          telemetry: {
            createdAt: at,
            updatedAt: at,
            correlationId: randomUUID(),
            errorCode: null,
            tasks: [],
            history: [
              {
                action: 'mission.transition',
                to: 'waiting_input',
                createdAt: at
              }
            ]
          }
        };
      if (drop) throw new PreflightClientError('preflight_timeout', true);
      return { mission: detail.mission, duplicate: false };
    },
    async getRehearsalMission() {
      reads++;
      if (unavailable)
        throw new PreflightClientError('preflight_timeout', true);
      if (!detail)
        throw new PreflightClientError('preflight_http_error', false, 404);
      return structuredClone(detail);
    }
  };
  const first = new PreflightRehearsalService(config, { client });
  const accepted = await first.start(
    randomUUID(),
    'missing_input',
    'synthetic-assurance'
  );
  assert.equal(accepted.delivery, 'uncertain');
  assert.equal(submissions, 1);
  const restarted = new PreflightRehearsalService(config, { client });
  unavailable = true;
  const unknown = await restarted.resume(accepted.id, 'synthetic-assurance');
  assert.ok(unknown.error);
  assert.equal(submissions, 1);
  if (unavailableTransport) {
    const error = new Error('Synthetic transport cannot be observed.');
    error.code = 'SYNTHETIC_UNAVAILABLE';
    throw error;
  }
  unavailable = false;
  const reconciled = await restarted.resume(accepted.id, 'synthetic-assurance');
  assert.equal(submissions, 1);
  assert.equal(reconciled.delivery, 'acknowledged');
  assert.equal(reconciled.missionStatus, 'waiting_input');
  assert.equal(reconciled.output, null);
  assert.equal(reconciled.receivedAt, null);
  assert.equal(reconciled.businessDecisionExecuted, false);
  await restarted.start(accepted.id, 'missing_input', 'synthetic-assurance');
  assert.equal(submissions, 1);
  // A separate mission was definitely not received: only a confirmed 404 permits replay.
  absent = true;
  detail = null;
  const missing = await restarted.start(
    randomUUID(),
    'missing_input',
    'synthetic-assurance'
  );
  assert.equal(missing.delivery, 'uncertain');
  assert.equal(submissions, 2);
  absent = false;
  drop = false;
  const resent = await restarted.resume(missing.id, 'synthetic-assurance');
  assert.equal(resent.delivery, 'acknowledged');
  assert.equal(submissions, 3);
  assert.equal(payloads[1].missionId, payloads[2].missionId);
  assert.equal(payloads[1].eventId, payloads[2].eventId);
  assert.equal((await restarted.list()).length, 2);
  return {
    submissionAttempts: submissions,
    logicalMissions: 2,
    observationCalls: reads,
    lostAcknowledgementReconciled: true,
    unavailableObservationDidNotReplay: true,
    replayOnlyAfterConfirmedAbsence: true,
    blockedInputRemainsBlocked: true,
    paidModelCalls: 0
  };
}
