import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { getAdminWorkQueue } from '../../../dist/apps/funding-api/src/admin-work-queue.service.js';
import { readFlowMeasurement } from '../../../dist/apps/funding-api/src/admin-flow-measurement.repository.js';
import { AdminAutomaticRunsService } from '../../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import {
  publicationReliability,
  detectPublicationReliabilityIncidents
} from '../../../dist/apps/funding-api/src/publication-reliability.repository.js';
import { ASSURANCE_CHECKS } from '../../../scripts/lib/operational-assurance.mjs';
import { safeLoadFailure } from '../../../scripts/lib/admin-load-profile.mjs';
import { startDisposablePostgres } from './disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './moderation-fixture.mjs';
import { assureAlertEpisodes } from './operational-assurance-alerts.mjs';
import { assurePreflightReconciliation } from './operational-assurance-preflight.mjs';

/** A finite synthetic cycle. No environment URLs, business producer or delivery worker. */
export async function runOperationalAssuranceCycle({
  signal,
  unavailableTransport = false
} = {}) {
  const result = {
    startedAt: new Date().toISOString(),
    status: 'passed',
    checks: [],
    cleanup: 'not_created',
    synthetic: true
  };
  if (signal?.aborted)
    return { ...result, status: 'interrupted', finishedAt: result.startedAt };
  let database, storage, temporaryRoot;
  const check = async (id, operation) => {
    if (signal?.aborted) return;
    const start = performance.now();
    try {
      result.checks.push({
        id,
        status: 'passed',
        facts: await operation(),
        elapsedMs: Math.round(performance.now() - start)
      });
    } catch (error) {
      result.checks.push({
        id,
        status: error?.code === 'ERR_ASSERTION' ? 'failed' : 'unavailable',
        code: safeLoadFailure(error),
        elapsedMs: Math.round(performance.now() - start)
      });
      result.status = 'failed';
    }
  };
  try {
    database = await startDisposablePostgres();
    const { pool } = database;
    await pool.query(
      "ALTER ROLE og7_test SET statement_timeout='10000ms';SET statement_timeout='10000ms'"
    );
    await check('alert_episodes', () => assureAlertEpisodes(pool));
    if (!signal?.aborted) {
      const id = (
        await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name,
        sponsor_public_summary,sponsor_contact_email,sponsor_review_status,sponsor_details_submitted_at,public_display_consent,sponsor_site_visibility_held)
        VALUES('sponsorship_interest',1500,'CAD','paid',NOW(),'Synthetic assurance','Synthetic public summary','synthetic@example.invalid','approved',NOW(),TRUE,TRUE) RETURNING id`)
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        channel: 'facebook',
        quantity: 2
      });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      const before = (
        await pool.query(
          'SELECT status,amount_cents,currency,public_display_consent,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0];
      const runs = new AdminAutomaticRunsService(pool);
      await check('admin_reads', async () => {
        const queue = await getAdminWorkQueue(pool, { overview: true });
        assert.equal(queue.available, true);
        assert.equal(queue.pendingDossierCount, 1);
        const flow = await readFlowMeasurement(pool, { sponsorshipId: id });
        assert.equal(flow.status, 'available');
        assert.equal(flow.totals.open, 2);
        const plan = await runs.preparationPlan();
        assert.equal(plan.items.length, 1);
        assert.equal(plan.items[0].drafts[0].ordinal, 1);
        return {
          pendingDossiers: queue.pendingDossierCount,
          openObligations: flow.totals.open,
          candidateDossiers: plan.candidateDossiers
        };
      });
      await check('private_preparation', async () => {
        const plan = await runs.preparationPlan();
        const start = {
          requestId: randomUUID(),
          preparationSelection: plan.items.map(
            ({ contributionId, version }) => ({ contributionId, version })
          )
        };
        const state = await runs.start(start, 'synthetic-assurance');
        const command = {
          runId: state.run.id,
          expectedVersion: state.run.version,
          requestId: randomUUID()
        };
        const completed = await runs.advance(command, 'synthetic-assurance');
        assert.equal(completed.run.status, 'completed');
        assert.deepEqual(
          await runs.advance(command, 'synthetic-assurance'),
          completed
        );
        assert.deepEqual(await runs.start(start, 'synthetic-assurance'), state);
        const drafts = (
          await pool.query(
            'SELECT title,body,disclosure_text,status FROM sponsor_publication_drafts WHERE contribution_id=$1',
            [id]
          )
        ).rows;
        assert.equal(drafts.length, 1);
        assert.equal(drafts[0].status, 'draft');
        assert.equal(drafts[0].body, plan.items[0].drafts[0].body);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT status,amount_cents,currency,public_display_consent,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
              [id]
            )
          ).rows[0],
          before
        );
        const counts = (
          await pool.query(`SELECT (SELECT count(*)::int FROM publication_deliveries) AS deliveries,
          (SELECT count(*)::int FROM sponsorship_fulfilment_evidence) AS proofs,
          (SELECT count(*)::int FROM fund_transactions) AS financial_facts,
          (SELECT count(*)::int FROM admin_preparation_approvals) AS approvals`)
        ).rows[0];
        assert.deepEqual(counts, {
          deliveries: 0,
          proofs: 0,
          financial_facts: 0,
          approvals: 0
        });
        return {
          privateDrafts: 1,
          replayDidNotDuplicate: true,
          financialFactsUnchanged: true,
          approvedPreparations: 0,
          publicationAttempts: 0
        };
      });
    }
    if (!signal?.aborted) {
      temporaryRoot = await realpath(tmpdir());
      storage = await mkdtemp(join(temporaryRoot, 'og7-assurance-'));
      await check('preflight_reconciliation', () =>
        assurePreflightReconciliation(storage, { unavailableTransport })
      );
    }
    await check('publication_uncertainty', async () => {
      const id = (
        await pool.query(`INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode,status,approved_at,approved_by)
        VALUES('openg7:facebook','news','Synthetic uncertain observation',NOW(),'synthetic-assurance-account','live','uncertain',NOW(),'synthetic-assurance') RETURNING id`)
      ).rows[0].id;
      await pool.query(
        `INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until,uncertain)
        VALUES('facebook','synthetic-assurance-account','live',$1,1,NOW()+interval '5 minutes',TRUE)`,
        [id]
      );
      const facts = await publicationReliability(pool);
      assert.equal(facts.deliveries.uncertain, 1);
      const incidents = await detectPublicationReliabilityIncidents(pool);
      assert.ok(
        incidents.some((i) => i.type === 'publication_account_result_uncertain')
      );
      const delivery = (
        await pool.query(
          'SELECT status,attempts FROM publication_deliveries WHERE id=$1',
          [id]
        )
      ).rows[0];
      assert.deepEqual(delivery, { status: 'uncertain', attempts: 0 });
      assert.equal(
        (
          await pool.query(
            'SELECT uncertain FROM publication_account_leases WHERE delivery_id=$1',
            [id]
          )
        ).rows[0].uncertain,
        true
      );
      return {
        uncertainDeliveries: 1,
        accountHoldPreserved: true,
        publicationAttempts: 0,
        automaticRetry: false
      };
    });
  } catch (error) {
    result.status = 'failed';
    result.setupCode = safeLoadFailure(error);
  } finally {
    const cleanupStarted = performance.now();
    let cleanupFailed = false;
    try {
      if (storage) {
        const resolved = await realpath(storage);
        assert.equal(dirname(resolved), temporaryRoot);
        assert.ok(basename(resolved).startsWith('og7-assurance-'));
        await rm(resolved, { recursive: true, force: true });
      }
    } catch {
      cleanupFailed = true;
    }
    try {
      if (database) await database.stop();
    } catch {
      cleanupFailed = true;
    }
    result.cleanup = cleanupFailed
      ? 'failed'
      : database
        ? 'confirmed'
        : 'not_created';
    result.checks.push({
      id: 'cleanup',
      status: cleanupFailed ? 'unavailable' : 'passed',
      facts: { state: result.cleanup },
      elapsedMs: Math.round(performance.now() - cleanupStarted)
    });
    if (cleanupFailed) result.status = 'failed';
  }
  for (const id of ASSURANCE_CHECKS)
    if (!result.checks.some((check) => check.id === id))
      result.checks.push({
        id,
        status: 'unavailable',
        code: 'NOT_OBSERVED',
        elapsedMs: null
      });
  if (signal?.aborted && result.cleanup !== 'failed')
    result.status = 'interrupted';
  result.finishedAt = new Date().toISOString();
  return result;
}
