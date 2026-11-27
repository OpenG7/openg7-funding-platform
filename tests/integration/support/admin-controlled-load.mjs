import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

import { getAdminWorkQueue } from '../../../dist/apps/funding-api/src/admin-work-queue.service.js';
import { readFlowMeasurement } from '../../../dist/apps/funding-api/src/admin-flow-measurement.repository.js';
import { AdminAutomaticRunsService } from '../../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { publicationReliability } from '../../../dist/apps/funding-api/src/publication-reliability.repository.js';
import {
  safeLoadFailure,
  summarizeLatencies
} from '../../../scripts/lib/admin-load-profile.mjs';
import { startDisposablePostgres } from './disposable-postgres.mjs';
import { seedPublicationBacklog } from './publication-backlog-performance.fixtures.mjs';
import {
  profilePublicationPool,
  explainPublicationRead
} from './publication-query-profile.mjs';

const round = (value) => Math.round(value * 100) / 100;

/** Fixed aggregate observation only; the extra observer never occupies the measured pool. */
async function observeDatabase(pool) {
  const client = new pg.Client({
    ...pool.options,
    password: pool.options.password,
    application_name: 'og7-controlled-load-observer',
    statement_timeout: 1000,
    query_timeout: 1500
  });
  await client.connect();
  let running = false;
  const observation = {
    intervalMs: 50,
    samples: 0,
    unavailableSamples: 0,
    maxActive: 0,
    maxLockWaiters: 0,
    maxIdleInTransaction: 0
  };
  const sample = async () => {
    if (running) return;
    running = true;
    try {
      const {
        rows: [row]
      } =
        await client.query(`SELECT count(*) FILTER(WHERE state='active')::int AS active,
        count(*) FILTER(WHERE wait_event_type='Lock')::int AS locks,
        count(*) FILTER(WHERE state='idle in transaction')::int AS idle
        FROM pg_stat_activity WHERE datname=current_database() AND application_name='og7-disposable-payment-tests'`);
      observation.samples++;
      observation.maxActive = Math.max(observation.maxActive, row.active);
      observation.maxLockWaiters = Math.max(
        observation.maxLockWaiters,
        row.locks
      );
      observation.maxIdleInTransaction = Math.max(
        observation.maxIdleInTransaction,
        row.idle
      );
    } catch {
      observation.unavailableSamples++;
    } finally {
      running = false;
    }
  };
  await sample();
  const timer = setInterval(() => void sample(), 50);
  return {
    observation,
    async stop() {
      clearInterval(timer);
      while (running) await new Promise((resolve) => setTimeout(resolve, 5));
      await client.end();
    }
  };
}

export async function runAdminLoadProfile(dossiers, options, { signal } = {}) {
  const started = performance.now();
  const result = {
    dossiers,
    status: 'passed',
    phases: [],
    plans: [],
    setupError: null
  };
  let database, observer;
  let stage = 'database';
  if (signal?.aborted)
    return { ...result, status: 'interrupted', totalElapsedMs: 0 };
  try {
    database = await startDisposablePostgres({
      maxConnections: options.poolSize,
      connectionTimeoutMillis: options.acquireTimeoutMs
    });
    const { pool } = database;
    // Fixed bounded numeric options only, applied solely to the freshly owned role.
    await pool.query(`ALTER ROLE og7_test SET statement_timeout='${options.statementTimeoutMs}ms';
      ALTER ROLE og7_test SET lock_timeout='5000ms'; SET statement_timeout='${options.statementTimeoutMs}ms'; SET lock_timeout='5000ms'`);
    stage = 'fixture';
    result.counts = await seedPublicationBacklog(pool, dossiers);
    result.fixture = {
      sponsorshipShare: 1,
      obligationsPerDossier: 2,
      review: 'pending_review',
      qualifiedExits: 0,
      ageDays: 30
    };
    stage = 'runtime';
    result.runtime = (
      await pool.query(
        "SELECT current_setting('server_version') AS postgres,current_setting('jit') AS jit,current_setting('max_connections')::int AS max_connections,current_setting('max_parallel_workers_per_gather')::int AS parallel_workers"
      )
    ).rows[0];
    const profile = profilePublicationPool(pool);
    const runs = new AdminAutomaticRunsService(profile.port);
    const invariants = async () =>
      (
        await pool.query(`SELECT
      (SELECT count(*)::int FROM admin_audit_log) AS audits,
      (SELECT count(*)::int FROM sponsor_publication_drafts) AS drafts,
      (SELECT count(*)::int FROM publication_deliveries) AS deliveries,
      (SELECT COALESCE(sum(attempts),0)::int FROM publication_deliveries) AS attempts,
      (SELECT count(*)::int FROM sponsorship_fulfilment_evidence) AS proofs,
      (SELECT count(*)::int FROM sponsorship_obligation_reservations WHERE released_at IS NULL) AS reservations,
      (SELECT count(*)::int FROM publication_account_reservations WHERE status='uncertain') AS uncertain,
      (SELECT count(*)::int FROM admin_automatic_runs) AS runs`)
      ).rows[0];
    stage = 'invariants';
    const before = await invariants();
    stage = 'observer';
    observer = await observeDatabase(pool);
    const nativeQueue = async () => {
      const data = await getAdminWorkQueue(profile.port, {
        overview: true,
        pageSize: 25
      });
      assert.equal(data.available, true);
      assert.equal(data.typeCounts.sponsorship_timing_review, dossiers * 2);
      assert.equal(data.pendingDossierCount, dossiers);
      assert.ok(data.items.length <= 25);
      return data.total;
    };
    const operations = {
      reliability: async () => {
        const data = await publicationReliability(profile.port);
        assert.equal(data.obligations.open, dossiers * 2);
        assert.equal(data.deliveries.uncertain, result.counts.uncertain);
        assert.equal(
          data.incidentTotal,
          dossiers * 2 + result.counts.uncertain
        );
        return data.incidentTotal;
      },
      flow: async () => {
        const data = await readFlowMeasurement(profile.port, {});
        assert.equal(data.status, 'available');
        assert.equal(data.totals.population, dossiers * 2);
        assert.equal(data.totals.open, dossiers * 2);
        assert.equal(data.totals.qualifiedExits, 0);
        return data.totals.open;
      },
      preparation_plan: async () => {
        const data = await runs.preparationPlan();
        assert.equal(data.candidateDossiers, 0);
        assert.equal(data.preservedPassages, result.counts.members);
        assert.equal(
          data.blockedPassages,
          dossiers * 2 - result.counts.members
        );
        return data.blockedPassages;
      },
      work_queue: nativeQueue
    };
    const phase = async (name, operation, concurrent = false) => {
      const latencies = [],
        failures = [],
        populations = [];
      const started = performance.now();
      let successful = 0,
        peakRss = process.memoryUsage().rss;
      const memory = setInterval(() => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }, 20);
      try {
        await profile.measure(name, async () => {
          const request = async () => {
            const t0 = performance.now();
            try {
              populations.push(await operation());
              successful++;
            } catch (error) {
              failures.push(safeLoadFailure(error));
            } finally {
              latencies.push(performance.now() - t0);
            }
          };
          if (concurrent)
            await Promise.all(
              Array.from({ length: options.concurrency }, () => request())
            );
          else
            for (let i = 0; i < options.samples; i++) {
              if (signal?.aborted) break;
              await request();
            }
          // Promise.all inside an owner can fail before its sibling reads settle.
          // Let all measured connections drain before assigning another phase.
          do {
            await new Promise((resolve) => setTimeout(resolve, 10));
          } while (pool.waitingCount || pool.totalCount > pool.idleCount);
        });
      } finally {
        clearInterval(memory);
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }
      const elapsedMs = performance.now() - started;
      const metrics = profile.measurements.at(-1);
      assert.ok(metrics.poolMaxTotal <= options.poolSize);
      result.phases.push({
        name,
        status: failures.length ? 'failed' : 'passed',
        latencies: summarizeLatencies(latencies),
        successful,
        failures,
        observedPopulations: [...new Set(populations)],
        elapsedMs: round(elapsedMs),
        completedRequestsPerSecond: round(successful / (elapsedMs / 1000)),
        peakNodeRssBytes: peakRss,
        metrics
      });
      if (failures.length) result.status = 'failed';
    };
    stage = 'measurements';
    for (const [name, operation] of Object.entries(operations)) {
      if (signal?.aborted) {
        result.status = 'interrupted';
        break;
      }
      await phase(name, operation);
    }
    if (signal?.aborted) result.status = 'interrupted';
    else await phase('concurrent_work_queue', nativeQueue, true);
    await observer.stop();
    result.databaseObservation = observer.observation;
    observer = null;
    assert.deepEqual(await invariants(), before);
    result.invariants = { unchanged: true, ...before };
    // Only owner SELECT/WITH captures are explainable; returned summaries omit SQL and binds.
    for (const name of ['work_queue', 'flow']) {
      if (signal?.aborted) {
        result.status = 'interrupted';
        break;
      }
      const heaviest = profile.queries
        .filter((q) => q.phase === name)
        .sort((a, b) => b.elapsedMs - a.elapsedMs)[0];
      if (!heaviest) continue;
      try {
        result.plans.push({
          phase: name,
          status: 'available',
          summary: await explainPublicationRead(pool, heaviest)
        });
      } catch (error) {
        result.plans.push({
          phase: name,
          status: 'unavailable',
          failure: safeLoadFailure(error)
        });
        result.status = 'failed';
      }
    }
  } catch (error) {
    result.status = 'failed';
    result.setupError = safeLoadFailure(error);
    result.failedAt = stage;
  } finally {
    if (observer) await observer.stop().catch(() => {});
    if (database) await database.stop();
  }
  result.totalElapsedMs = round(performance.now() - started);
  return result;
}
