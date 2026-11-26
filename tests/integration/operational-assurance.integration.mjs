import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyAssuranceEpisodes,
  observeAssuranceEpisodes
} from '../../scripts/lib/operational-assurance.mjs';
import { runOperationalAssuranceCycle } from './support/operational-assurance.mjs';

test(
  'an isolated assurance cycle verifies native effects and closes all owned resources without exporting private inputs',
  { timeout: 90000 },
  async () => {
    const cycle = await runOperationalAssuranceCycle();
    assert.equal(cycle.status, 'passed');
    assert.equal(cycle.cleanup, 'confirmed');
    assert.equal(cycle.checks.length, 6);
    assert.ok(cycle.checks.every((c) => c.status === 'passed'));
    assert.equal(
      cycle.checks.find((c) => c.id === 'alert_episodes').facts
        .logicalNotifications,
      2
    );
    assert.equal(
      cycle.checks.find((c) => c.id === 'preflight_reconciliation').facts
        .submissionAttempts,
      3
    );
    assert.equal(
      cycle.checks.find((c) => c.id === 'publication_uncertainty').facts
        .automaticRetry,
      false
    );
    assert.doesNotMatch(
      JSON.stringify(cycle),
      /@example|private-body|private-subject|password|SELECT |https?:\/\//
    );
  }
);
test(
  'periodic unknown transport observations deduplicate an episode and recover only on the later native success',
  { timeout: 120000 },
  async () => {
    let state = emptyAssuranceEpisodes();
    const events = [];
    for (const unavailableTransport of [true, true, false]) {
      const cycle = await runOperationalAssuranceCycle({
        unavailableTransport
      });
      assert.equal(cycle.cleanup, 'confirmed');
      const probe = cycle.checks.find(
        (c) => c.id === 'preflight_reconciliation'
      );
      assert.equal(
        probe.status,
        unavailableTransport ? 'unavailable' : 'passed'
      );
      assert.ok(
        cycle.checks
          .filter((c) => c.id !== 'preflight_reconciliation')
          .every((c) => c.status === 'passed')
      );
      const result = observeAssuranceEpisodes(
        state,
        cycle.checks,
        cycle.finishedAt
      );
      state = result.state;
      events.push(...result.events);
      assert.equal(state.episodes.length, 1);
    }
    assert.deepEqual(
      events.map((e) => e.type),
      ['opened', 'resolved']
    );
    assert.equal(events[0].id, events[1].id);
    assert.ok(state.episodes[0].resolvedAt);
  }
);
test('preinterrupted assurance does not create synthetic resources or claim healthy observations', async () => {
  const controller = new AbortController();
  controller.abort();
  const cycle = await runOperationalAssuranceCycle({
    signal: controller.signal
  });
  assert.equal(cycle.status, 'interrupted');
  assert.equal(cycle.cleanup, 'not_created');
  assert.equal(cycle.checks.length, 0);
});
