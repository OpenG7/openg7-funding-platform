import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import {
  detectPublicationReliabilityIncidents,
  publicationReliability,
  publicationReliabilityIncidentPage
} from '../../dist/apps/funding-api/src/publication-reliability.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { seedPublicationBacklog } from './support/publication-backlog-performance.fixtures.mjs';
import {
  explainPublicationRead,
  profilePublicationPool
} from './support/publication-query-profile.mjs';

test(
  'publication preparation and global reliability remain bounded over 3,000 synthetic dossiers',
  { timeout: 120000 },
  async (t) => {
    const started = performance.now();
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    // A disposable role default also covers clients borrowed by the real service.
    await pool.query(
      "ALTER ROLE og7_test SET statement_timeout='30s'; SET statement_timeout='30s'"
    );
    const counts = await seedPublicationBacklog(pool);
    const profile = profilePublicationPool(pool);
    const service = new PublicationAutomationService(
      profile.port,
      {},
      {
        SOCIAL_PUBLICATION_MODE: 'mock',
        SOCIAL_PUBLICATION_WORKER_ENABLED: 'false'
      }
    );
    const facts = await profile.measure('global_initial', () =>
      publicationReliability(profile.port)
    );
    assert.equal(facts.obligations.open, counts.obligations);
    assert.equal(
      facts.obligations.undatedSocial,
      counts.obligations - counts.members
    );
    assert.equal(facts.obligations.overdue, counts.obligations);
    assert.equal(facts.deliveries.uncertain, counts.uncertain);
    assert.equal(facts.capacity.accountConflicts, 0);
    assert.equal(facts.incidentTotal, counts.obligations + counts.uncertain);
    assert.equal(facts.incidents.length, 50);
    const first = await profile.measure('incident_first', () =>
      publicationReliabilityIncidentPage(profile.port)
    );
    const second = await profile.measure('incident_continuation', () =>
      publicationReliabilityIncidentPage(profile.port, {
        cursor: first.nextCursor
      })
    );
    assert.equal(first.globalTotal, facts.incidentTotal);
    assert.equal(second.globalTotal, facts.incidentTotal);
    assert.equal(second.snapshot, first.snapshot);
    assert.equal(first.incidents.length, 50);
    assert.equal(second.incidents.length, 50);
    assert.equal(
      new Set(
        [...first.incidents, ...second.incidents].map(
          (incident) => `${incident.code}:${incident.subjectId}`
        )
      ).size,
      100
    );
    const detected = await profile.measure('complete_alert_detector', () =>
      detectPublicationReliabilityIncidents(profile.port)
    );
    assert.equal(detected.length, facts.incidentTotal);
    await profile.measure('prepare_initial', () =>
      service.prepare('openg7:facebook', 'synthetic-performance')
    );
    const draftsBefore = Number(
      (await pool.query('SELECT count(*) n FROM sponsor_publication_drafts'))
        .rows[0].n
    );
    assert.equal(draftsBefore, counts.dossiers);
    const beforeAudit = Number(
      (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0].n
    );
    const state = await profile.measure('state_full', () => service.state());
    assert.equal(state.reliability.obligations.open, counts.obligations);
    assert.equal(state.reliability.incidentTotal, facts.incidentTotal);
    assert.equal(state.deliveries.length, 200);
    assert.equal(state.queue.entries.length, 200);
    assert.equal(
      Number(
        (await pool.query('SELECT count(*) n FROM admin_audit_log')).rows[0].n
      ),
      beforeAudit
    );
    await profile.measure('concurrent_prepare_and_read', () =>
      Promise.all([
        service.prepare('openg7:facebook', 'synthetic-performance-replay-a'),
        service.prepare('openg7:facebook', 'synthetic-performance-replay-b'),
        service.reliabilityIncidents({ code: 'ACCOUNT_RESULT_UNCERTAIN' })
      ])
    );
    assert.equal(
      Number(
        (await pool.query('SELECT count(*) n FROM sponsor_publication_drafts'))
          .rows[0].n
      ),
      draftsBefore
    );
    const {
      rows: [authority]
    } = await pool.query(`SELECT
      (SELECT count(*)::int FROM publication_account_leases WHERE uncertain) uncertain_accounts,
      (SELECT count(*)::int FROM publication_account_reservations WHERE status='uncertain') uncertain_reservations,
      (SELECT count(*)::int FROM sponsorship_obligation_reservations WHERE released_at IS NULL) obligation_reservations,
      (SELECT count(*)::int FROM sponsorship_fulfilment_evidence) proofs`);
    assert.equal(authority.uncertain_accounts, counts.uncertain);
    assert.equal(authority.uncertain_reservations, counts.uncertain);
    assert.equal(authority.obligation_reservations, counts.members);
    assert.equal(authority.proofs, 0);
    const {
      rows: [capacity]
    } = await pool.query(`SELECT max(used)::int max_used FROM (
    SELECT b.id,count(d.id) used FROM publication_recurrences r JOIN sponsor_publication_batches b ON b.id=r.batch_id
    LEFT JOIN sponsor_publication_drafts d ON d.batch_id=b.id WHERE r.feed_id='openg7:facebook' GROUP BY b.id) occupancy`);
    assert.ok(capacity.max_used > 0 && capacity.max_used <= 10);
    const candidateQueries = profile.queries.filter(
      (query) =>
        query.text.includes('source_fingerprint_material') &&
        query.text.includes('SKIP LOCKED') &&
        query.values?.[2] === 400
    );
    assert.ok(candidateQueries.length >= 1);
    assert.ok(candidateQueries.every((query) => query.rowCount <= 400));
    assert.ok(
      profile.measurements.every(
        (measurement) => measurement.failedQueries === 0
      )
    );
    assert.ok(
      profile.measurements.find(
        (measurement) => measurement.name === 'prepare_initial'
      ).queryCount < 500,
      'preparation query count must depend on the bounded horizon, not 3,000 dossier loops'
    );
    for (const name of [
      'global_initial',
      'incident_first',
      'incident_continuation',
      'complete_alert_detector'
    ]) {
      assert.equal(
        profile.measurements.find((measurement) => measurement.name === name)
          .queryCount,
        1
      );
    }
    const plans = {};
    for (const name of [
      'global_initial',
      'incident_first',
      'complete_alert_detector'
    ]) {
      plans[name] = await explainPublicationRead(
        pool,
        profile.queries.find((query) => query.phase === name)
      );
    }
    plans.preparation_candidates = await explainPublicationRead(
      pool,
      candidateQueries[0]
    );
    const slowStateQueries = profile.queries
      .filter((query) => query.phase === 'state_full')
      .sort((first, second) => second.elapsedMs - first.elapsedMs)
      .slice(0, 2);
    for (const [index, query] of slowStateQueries.entries()) {
      plans[`state_heaviest_${index + 1}`] = await explainPublicationRead(
        pool,
        query
      );
      assert.ok(
        plans[`state_heaviest_${index + 1}`].nodes.every(
          (node) =>
            !(
              node.type === 'Seq Scan' &&
              node.alias === 'held_source' &&
              node.loops > 1
            )
        ),
        'a full uncertainty scan must not repeat for each source dossier'
      );
    }
    const {
      rows: [settings]
    } = await pool.query(
      "SELECT current_setting('server_version') version,current_setting('jit') jit,current_setting('max_parallel_workers_per_gather') parallel_workers"
    );
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        postgres: settings.version,
        jit: settings.jit,
        parallelWorkers: settings.parallel_workers
      },
      scope: 'disposable-synthetic-postgresql-no-provider-send',
      counts,
      measuredIncidentTotal: facts.incidentTotal,
      responseLimits: {
        correlations: 50,
        incidentPage: 50,
        deliveryPage: 200,
        sourceQueuePage: 200,
        preparationScan: 400
      },
      measurements: profile.measurements,
      plans,
      totalElapsedMs: Math.round(performance.now() - started)
    };
    const serialized = JSON.stringify(report, null, 2);
    assert.doesNotMatch(
      serialized,
      /SYNTHETIC_PRIVATE|@example|storageKey|accountId|message|password|SELECT|INSERT/
    );
    const directory = new URL('../../test-results/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(
      new URL('publication-backlog-performance.json', directory),
      `${serialized}\n`,
      'utf8'
    );
    t.diagnostic(
      JSON.stringify({
        counts,
        measurements: profile.measurements,
        totalElapsedMs: report.totalElapsedMs
      })
    );
  }
);
