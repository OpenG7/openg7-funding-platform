import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  ASSURANCE_CHECKS,
  parseAssuranceOptions,
  emptyAssuranceEpisodes,
  observeAssuranceEpisodes
} from '../scripts/lib/operational-assurance.mjs';

const target = 'preflight_reconciliation';
const checks = (status) =>
  ASSURANCE_CHECKS.map((id) => ({
    id,
    status: id === target ? status : 'passed'
  }));
const at = (n) => new Date(Date.UTC(2026, 10, 25, 12, 0, n)).toISOString();
test('assurance plan is bounded, nonexecuting and cannot accept a production or notification target', () => {
  assert.equal(parseAssuranceOptions([]).run, false);
  assert.equal(parseAssuranceOptions([]).cycles, 1);
  assert.equal(
    parseAssuranceOptions([
      '--run',
      '--cycles=3',
      '--interval-ms=1000',
      '--exercise=failure-recovery'
    ]).exercise,
    'failure-recovery'
  );
  for (const args of [
    ['--url=https://example.invalid'],
    ['--notify'],
    ['--production'],
    ['--cycles=0'],
    ['--cycles=13'],
    ['--interval-ms=0'],
    ['--interval-ms=60001'],
    ['--run', '--plan'],
    ['--run', '--run'],
    ['--exercise=failure-recovery'],
    ['--exercise=live']
  ])
    assert.throws(() => parseAssuranceOptions(args));
});
test('successful synthetic observations create no failure episode', () => {
  const result = observeAssuranceEpisodes(
    emptyAssuranceEpisodes(),
    checks('passed'),
    at(0)
  );
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.state.episodes, []);
});
test('repeated failure and unknown readings retain one episode and its real first observation', () => {
  const first = observeAssuranceEpisodes(
    emptyAssuranceEpisodes(),
    checks('failed'),
    at(1)
  );
  const repeated = observeAssuranceEpisodes(
    first.state,
    checks('failed'),
    at(2)
  );
  const unknown = observeAssuranceEpisodes(
    repeated.state,
    checks('unavailable'),
    at(3)
  );
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].type, 'opened');
  assert.equal(repeated.events.length, 0);
  assert.equal(unknown.events.length, 0);
  assert.equal(unknown.state.episodes.length, 1);
  assert.equal(unknown.state.episodes[0].id, first.state.episodes[0].id);
  assert.equal(unknown.state.episodes[0].openedAt, at(1));
  assert.equal(unknown.state.episodes[0].observations, 3);
  assert.equal(unknown.state.episodes[0].resolvedAt, null);
  assert.equal(first.state.episodes[0].observations, 1);
});
test('missing observations never close an episode; only a confirmed healthy check does', () => {
  const first = observeAssuranceEpisodes(
    emptyAssuranceEpisodes(),
    checks('unavailable'),
    at(1)
  );
  const missing = observeAssuranceEpisodes(
    first.state,
    checks('passed').filter((c) => c.id !== target),
    at(2)
  );
  assert.equal(missing.state.episodes[0].resolvedAt, null);
  const recovered = observeAssuranceEpisodes(
    missing.state,
    checks('passed'),
    at(3)
  );
  assert.deepEqual(
    recovered.events.map((e) => e.type),
    ['resolved']
  );
  assert.equal(recovered.state.episodes[0].resolvedAt, at(3));
  const recurrence = observeAssuranceEpisodes(
    recovered.state,
    checks('failed'),
    at(4)
  );
  assert.equal(recurrence.state.episodes.length, 2);
  assert.notEqual(
    recurrence.state.episodes[1].id,
    recovered.state.episodes[0].id
  );
  assert.deepEqual(
    recurrence.events.map((e) => e.type),
    ['opened']
  );
});
test('stale, malformed and ambiguous observations fail before changing episode history', () => {
  const original = observeAssuranceEpisodes(
    emptyAssuranceEpisodes(),
    checks('failed'),
    at(2)
  ).state;
  const frozen = structuredClone(original);
  for (const [input, time] of [
    [checks('passed'), at(1)],
    [checks('passed'), 'invalid'],
    [[...checks('passed'), checks('passed')[0]], at(3)],
    [[{ id: 'unknown', status: 'passed' }], at(3)],
    [[{ id: target, status: 'maybe' }], at(3)]
  ])
    assert.throws(() => observeAssuranceEpisodes(original, input, time));
  assert.deepEqual(original, frozen);
});
test('the executable plan ignores configured application targets and emits no connection material', () => {
  const stdout = execFileSync(
    process.execPath,
    ['scripts/operational-assurance.mjs', '--plan'],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        DATABASE_URL: 'synthetic-unused-database-url',
        FUNDING_OPERATIONS_WEBHOOK_URL: 'https://unused.example.invalid'
      }
    }
  );
  const plan = JSON.parse(stdout);
  assert.equal(plan.run, false);
  assert.equal(plan.productionAccess, false);
  assert.equal(plan.externalNotifications, false);
  assert.doesNotMatch(
    stdout,
    /synthetic-unused-database-url|unused.example.invalid/
  );
});
