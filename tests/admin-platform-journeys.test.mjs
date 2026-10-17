import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlatformJourneys,
  JOURNEY_OBSERVATION_MAX_AGE_MS
} from '../dist/apps/funding-api/src/admin-cockpit/journeys.projection.js';
import { getCockpitJourneys } from '../dist/apps/funding-api/src/admin-cockpit/journeys.js';

const now = new Date('2026-10-17T14:00:00Z');
const recent = '2026-10-17T13:59:30Z';
const contribution = {
  source: 'available',
  complete: true,
  observedAt: recent,
  environment: 'test',
  steps: {
    checkout: recent,
    payment: recent,
    confirmation: recent,
    followup: recent
  }
};
const journey = (result, id = 'contribution') =>
  result.journeys.find((j) => j.id === id);

test('six fixed journeys require a correlated full chain before a green indicator', () => {
  const result = buildPlatformJourneys({ contribution }, now);
  assert.deepEqual(
    result.journeys.map((j) => j.id),
    [
      'contribution',
      'invoicing',
      'sponsorship',
      'publication',
      'transparency',
      'administration'
    ]
  );
  assert.equal(journey(result).state, 'operational');
  assert.equal(journey(result).evidenceScope, 'correlated_records');
  assert.equal(journey(result).environment, 'test');
  assert.ok(journey(result).steps.every((s) => s.state === 'operational'));
  for (const patch of [
    { complete: false },
    { steps: { checkout: recent, payment: recent, confirmation: recent } },
    { source: 'missing' },
    { observedAt: '2026-10-17T14:01:00Z' },
    { observedAt: 'invalid' }
  ])
    assert.equal(
      journey(
        buildPlatformJourneys(
          { contribution: { ...contribution, ...patch } },
          now
        )
      ).state,
      'unknown'
    );
});

test('terminal correlated evidence may attest earlier stages but expires at the exact freshness limit', () => {
  const old = '2026-10-10T14:00:00Z';
  const facts = {
    contribution: {
      ...contribution,
      steps: { ...contribution.steps, checkout: old }
    }
  };
  const fresh = journey(buildPlatformJourneys(facts, now));
  assert.equal(fresh.state, 'operational');
  assert.equal(fresh.steps[0].observedAt, new Date(old).toISOString());
  assert.equal(fresh.steps[0].state, 'operational');
  const expiry = new Date(Date.parse(recent) + JOURNEY_OBSERVATION_MAX_AGE_MS);
  assert.equal(journey(buildPlatformJourneys(facts, expiry)).state, 'unknown');
  const nearlyStale = { ...contribution, observedAt: '2026-10-17T13:45:10Z' };
  assert.equal(
    journey(buildPlatformJourneys({ contribution: nearlyStale }, now))
      .validUntil,
    '2026-10-17T14:00:10.000Z'
  );
});

test('partial stages expire independently and unrelated successes cannot complete a journey', () => {
  const result = journey(
    buildPlatformJourneys(
      {
        contribution: {
          ...contribution,
          complete: false,
          steps: { ...contribution.steps, checkout: '2026-10-17T13:45:05Z' }
        }
      },
      now
    )
  );
  assert.equal(result.state, 'unknown');
  assert.equal(result.evidenceScope, 'partial_records');
  assert.equal(result.steps[0].validUntil, '2026-10-17T14:00:05.000Z');
});

test('human approval waits are unknown, while confirmed failures and delays remain visible', () => {
  for (const waiting of ['awaiting_review', 'awaiting_authorization']) {
    const result = journey(
      buildPlatformJourneys(
        { contribution: { source: 'available', waiting } },
        now
      )
    );
    assert.equal(result.state, 'unknown');
    assert.equal(result.diagnostic, waiting);
  }
  for (const [diagnostic, state] of [
    ['processing_failed', 'unavailable'],
    ['processing_delayed', 'degraded'],
    ['delivery_uncertain', 'degraded']
  ]) {
    const result = journey(
      buildPlatformJourneys(
        {
          contribution: {
            ...contribution,
            issue: { diagnostic, stepId: 'confirmation', observedAt: recent }
          }
        },
        now
      )
    );
    assert.equal(result.state, state);
    assert.equal(result.evidenceScope, 'partial_records');
    assert.equal(result.observedAt, new Date(recent).toISOString());
    assert.equal(
      result.steps.find((s) => s.id === 'confirmation').state,
      state
    );
    const failureOnly = journey(
      buildPlatformJourneys(
        {
          contribution: {
            source: 'available',
            issue: { diagnostic, stepId: 'confirmation', observedAt: recent }
          }
        },
        now
      )
    );
    assert.equal(
      failureOnly.steps.find((s) => s.id === 'confirmation').evidenceScope,
      'partial_records'
    );
    assert.equal(
      result.environment,
      'unknown',
      'an issue cannot inherit the mode of another successful operation'
    );
  }
});

test('SMTP acceptance is explicit and authenticated reads do not attest the login flow', () => {
  const result = buildPlatformJourneys(
    {
      invoicing: {
        source: 'available',
        complete: true,
        observedAt: recent,
        steps: { payment: recent, invoice: recent, email: recent }
      }
    },
    now,
    true
  );
  const invoice = journey(result, 'invoicing');
  assert.equal(invoice.state, 'operational');
  assert.equal(
    invoice.steps.find((s) => s.id === 'email').diagnostic,
    'smtp_accepted'
  );
  const admin = journey(result, 'administration');
  assert.equal(admin.state, 'unknown');
  assert.equal(admin.steps.find((s) => s.id === 'login').state, 'unknown');
  assert.equal(
    admin.steps.find((s) => s.id === 'session').state,
    'operational'
  );
  assert.equal(
    admin.steps.find((s) => s.id === 'api_access').evidenceScope,
    'authenticated_request'
  );
});

test('an incident from another mode never relabels the successful chain stages', () => {
  for (const [successfulMode, failingMode] of [
    ['live', 'test'],
    ['test', 'live']
  ]) {
    const result = journey(
      buildPlatformJourneys(
        {
          contribution: {
            ...contribution,
            environment: successfulMode,
            issue: {
              diagnostic: 'processing_failed',
              stepId: 'confirmation',
              observedAt: recent,
              environment: failingMode
            }
          }
        },
        now
      )
    );
    assert.equal(result.environment, failingMode);
    for (const step of result.steps)
      assert.equal(
        step.environment,
        step.id === 'confirmation' ? failingMode : successfulMode
      );
  }
});

test('absent sources and database errors fail closed without exposing private errors or issuing probes', async () => {
  assert.equal(
    journey(await getCockpitJourneys(null, now)).diagnostic,
    'source_missing'
  );
  const result = await getCockpitJourneys(
    {
      connect: async () => {
        throw new Error('private-path secret@example.invalid');
      }
    },
    now,
    true
  );
  assert.equal(journey(result).state, 'unknown');
  assert.equal(journey(result).diagnostic, 'source_unavailable');
  assert.ok(!JSON.stringify(result).includes('private-path'));
  assert.ok(
    result.journeys.every((j) =>
      /^\/admin\/fundraiser(?:\/|$)/.test(j.adminUrl)
    )
  );
});
