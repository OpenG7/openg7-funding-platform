import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PublicationWorkshopService } from '../../dist/apps/funding-api/src/preflight/workshop.js';
import { PreflightClientError } from '../../dist/apps/funding-api/src/preflight/client.js';
import {
  createAdminPublicationDraftOnConnection,
  updateAdminPublicationDraftOnConnection
} from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  startDisposablePostgres,
  observePostgresTransactions
} from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { workshopRemoteDetail } from '../support/publication-workshop-fixture.mjs';
import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';

const config = {
  enabled: true,
  tenantId: 'synthetic-workshop-tenant',
  baseUrl: 'https://preflight.invalid',
  tokenUrl: 'https://identity.invalid/token',
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  requestTimeoutMs: 1000,
  maxCostUsd: 0
};

test(
  'durable workshop survives unavailable Preflight, isolates source versions and adopts only unchanged private drafts',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    t.after(stop);
    const database = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    const migrations = readMigrations('apps/funding-api/migrations');
    await pool.query(
      buildMigrationSql(
        migrations.filter((m) => m.version <= 67),
        { database }
      )
    );
    const observed = observePostgresTransactions(pool),
      remote = new Map();
    let offline = true,
      submitted = 0;
    const client = {
      async notifySourceUpdate() {
        assert.equal(observed.openTransactions, 0);
        if (offline) throw new PreflightClientError('preflight_timeout', true);
        return { duplicate: false, invalidated: 0 };
      },
      async getMission(id) {
        assert.equal(observed.openTransactions, 0);
        const detail = remote.get(id);
        if (!detail)
          throw new PreflightClientError('preflight_http_error', false, 404);
        return detail;
      },
      async submit(mission) {
        assert.equal(observed.openTransactions, 0);
        submitted++;
        const detail = workshopRemoteDetail(mission);
        remote.set(mission.missionId, detail);
        return { mission: detail.mission, duplicate: false };
      }
    };
    const service = new PublicationWorkshopService(observed.pool, config, {
      client
    });
    const id = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
    public_display_consent,sponsor_site_visibility_held) VALUES('sponsorship_interest',25000,'CAD','paid',NOW(),FALSE,TRUE) RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, id, {
      channels: ['website', 'facebook']
    });
    const pristine = async () => ({
      obligations: (
        await pool.query(
          'SELECT id,state,version,fulfilment_evidence_id FROM sponsorship_obligations WHERE contribution_id=$1 ORDER BY id',
          [id]
        )
      ).rows,
      deliveries: (
        await pool.query(
          'SELECT count(*)::int AS n FROM publication_deliveries'
        )
      ).rows[0].n,
      proofs: (
        await pool.query(
          'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence'
        )
      ).rows[0].n,
      decisions: (
        await pool.query(
          'SELECT count(*)::int AS n FROM admin_service_preparation_decisions'
        )
      ).rows[0].n
    });
    const before = await pristine();
    const disabled = new PublicationWorkshopService(observed.pool, {
      enabled: false
    });
    assert.equal(
      (await disabled.read(id)).enabled,
      false,
      'disabled connector does not require the new tables'
    );
    await assert.rejects(service.ready(), {
      code: 'PUBLICATION_WORKSHOP_SCHEMA_REQUIRED'
    });
    await pool.query(buildMigrationSql(migrations, { database }));
    await pool.query(buildMigrationSql(migrations, { database }));
    assert.deepEqual(
      await pristine(),
      before,
      '068 preserves the existing agreements and decisions and is runner-idempotent'
    );
    assert.equal((await service.read(id)).sourceVersion, null);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM preflight_workshop_missions'
        )
      ).rows[0].n,
      0,
      'reads do not generate'
    );
    await service.tick();
    const queued = await service.read(id);
    assert.equal(queued.sourceVersion, 1);
    assert.equal(queued.mission.delivery, 'uncertain');
    assert.equal(submitted, 0);
    offline = false;
    await pool.query(
      'UPDATE preflight_workshop_missions SET next_attempt_at=NOW()'
    );
    const restarted = new PublicationWorkshopService(observed.pool, config, {
      client
    });
    await Promise.all([restarted.tick(), service.tick()]);
    const partial = await service.read(id);
    assert.equal(submitted, 1);
    assert.equal(partial.proposal.editorialPreparation.state, 'partial');
    assert.equal(partial.canAdopt, false);
    assert.deepEqual(
      partial.proposal.editorialPreparation.variants
        .map((v) => v.destination)
        .sort(),
      ['facebook', 'website']
    );
    assert.ok(
      partial.proposal.editorialPreparation.common.missingInformation.includes(
        'organization'
      )
    );
    assert.ok(
      partial.proposal.editorialPreparation.common.missingInformation.includes(
        'contact_email'
      )
    );
    assert.equal(partial.proposal.provenance.simulated, true);
    await service.tick();
    assert.equal(submitted, 1, 'unchanged events never create another mission');
    await assert.rejects(
      service.adopt(
        {
          contributionId: id,
          proposalId: partial.proposal.id,
          expectedSourceVersion: 1,
          requestId: randomUUID()
        },
        'synthetic-operator'
      ),
      { code: 'PUBLICATION_WORKSHOP_PROPOSAL_NOT_CURRENT' }
    );
    await pool.query(
      `UPDATE fund_contributions SET sponsor_company_name='Synthetic partner',sponsor_contact_email='private@example.invalid',
    sponsor_public_summary='Synthetic consented source',public_display_consent=TRUE,sponsor_review_status='approved',updated_at=clock_timestamp() WHERE id=$1`,
      [id]
    );
    assert.equal(
      (await service.read(id)).proposal,
      null,
      'changed source blocks stale proposal before the worker runs'
    );
    await service.tick();
    const prepared = await service.read(id);
    assert.equal(prepared.sourceVersion, 2);
    assert.equal(prepared.canAdopt, true);
    assert.equal(
      prepared.history.find((p) => p.id === partial.proposal.id).obsolete,
      true
    );
    const payload = (
      await pool.query(
        'SELECT payload FROM preflight_workshop_missions WHERE id=$1',
        [prepared.mission.id]
      )
    ).rows[0].payload;
    assert.doesNotMatch(
      JSON.stringify(payload),
      /private@example|25000|amountMinor|currency/
    );
    assert.equal(
      (
        await pool.query(
          'SELECT sponsor_details_submitted_at FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0].sponsor_details_submitted_at,
      null,
      'administrative correction is not a sponsor form submission'
    );
    const request = {
      contributionId: id,
      proposalId: prepared.proposal.id,
      expectedSourceVersion: 2,
      requestId: randomUUID()
    };
    const concurrent = await Promise.allSettled([
      service.adopt(request, 'synthetic-operator'),
      service.adopt({ ...request, requestId: randomUUID() }, 'synthetic-other')
    ]);
    assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
    const successful = concurrent[0].status === 'fulfilled' ? request : null;
    if (successful) {
      await service.adopt(request, 'synthetic-operator');
      await assert.rejects(service.adopt(request, 'different-actor'), {
        code: 'PUBLICATION_WORKSHOP_REQUEST_CONFLICT'
      });
    }
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM preflight_workshop_adoptions'
        )
      ).rows[0].n,
      1
    );
    const drafts = (
      await pool.query(
        'SELECT * FROM sponsor_publication_drafts WHERE contribution_id=$1',
        [id]
      )
    ).rows;
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].status, 'draft');
    assert.equal(drafts[0].approved_at, null);
    assert.equal(drafts[0].published_at, null);
    assert.deepEqual(
      await pristine(),
      before,
      'adoption creates no business decision, delivery or fulfilment proof'
    );
    await service.tick();
    const current = await service.read(id);
    await withPostgresTransaction(pool, (db) =>
      updateAdminPublicationDraftOnConnection(
        db,
        {
          draftId: drafts[0].id,
          body: 'Manually corrected synthetic channel text'
        },
        'synthetic-editor'
      )
    );
    await assert.rejects(
      service.adopt(
        {
          contributionId: id,
          proposalId: current.proposal.id,
          expectedSourceVersion: current.sourceVersion,
          requestId: randomUUID()
        },
        'synthetic-operator'
      ),
      { code: 'PUBLICATION_WORKSHOP_PROPOSAL_NOT_CURRENT' }
    );
    await service.tick();
    const regenerated = await service.read(id);
    await assert.rejects(
      service.adopt(
        {
          contributionId: id,
          proposalId: regenerated.proposal.id,
          expectedSourceVersion: regenerated.sourceVersion,
          requestId: randomUUID()
        },
        'synthetic-operator'
      ),
      { code: 'PUBLICATION_WORKSHOP_MANUAL_CHANGES_PRESERVED' }
    );
    assert.equal(
      (
        await pool.query(
          'SELECT body FROM sponsor_publication_drafts WHERE id=$1',
          [drafts[0].id]
        )
      ).rows[0].body,
      'Manually corrected synthetic channel text'
    );
    const otherTenant = new PublicationWorkshopService(
      pool,
      { ...config, tenantId: 'different-tenant' },
      { client }
    );
    assert.equal((await otherTenant.read(id)).proposal, null);
    assert.equal((await otherTenant.read(id)).history.length, 0);
    await assert.rejects(otherTenant.adopt(request, 'synthetic-operator'), {
      code: 'PUBLICATION_WORKSHOP_REQUEST_CONFLICT'
    });
    await assert.rejects(
      pool.query("UPDATE preflight_workshop_proposals SET proposal='{}'"),
      /immutable/
    );
    await assert.rejects(
      pool.query("UPDATE preflight_workshop_missions SET payload='{}'"),
      /immutable/
    );
    assert.deepEqual(await pristine(), before);
  }
);

test(
  'native manually edited channel drafts are preserved across regeneration and public Web content remains locked',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const remote = new Map(),
      client = {
        async notifySourceUpdate() {
          return { duplicate: false, invalidated: 0 };
        },
        async getMission(id) {
          if (!remote.has(id))
            throw new PreflightClientError('preflight_http_error', false, 404);
          return remote.get(id);
        },
        async submit(mission) {
          const detail = workshopRemoteDetail(mission);
          remote.set(mission.missionId, detail);
          return { mission: detail.mission, duplicate: false };
        }
      };
    const id = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name,
    sponsor_contact_email,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
    VALUES('sponsorship_interest',25000,'CAD','paid',NOW(),'Synthetic editable partner','private@example.invalid','Original public summary',TRUE,'approved',TRUE) RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, id, {
      channels: ['website', 'facebook']
    });
    const draft = await withPostgresTransaction(pool, (db) =>
      createAdminPublicationDraftOnConnection(
        db,
        { contributionId: id, feedTarget: 'openg7', channel: 'facebook' },
        'synthetic'
      )
    );
    await withPostgresTransaction(pool, (db) =>
      updateAdminPublicationDraftOnConnection(
        db,
        { draftId: draft.draft.id, body: 'Private manual channel text' },
        'synthetic'
      )
    );
    const service = new PublicationWorkshopService(pool, config, { client });
    await service.tick();
    const state = await service.read(id);
    await assert.rejects(
      service.adopt(
        {
          contributionId: id,
          proposalId: state.proposal.id,
          expectedSourceVersion: state.sourceVersion,
          requestId: randomUUID()
        },
        'synthetic'
      ),
      { code: 'PUBLICATION_WORKSHOP_MANUAL_CHANGES_PRESERVED' }
    );
    assert.equal(
      (
        await pool.query(
          'SELECT sponsor_public_summary FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0].sponsor_public_summary,
      'Original public summary',
      'whole adoption rolls back on a channel conflict'
    );
    await pool.query(
      'UPDATE fund_contributions SET sponsor_site_visibility_held=FALSE WHERE id=$1',
      [id]
    );
    assert.equal((await service.read(id)).canAdopt, false);
  }
);

test(
  'lost remote acknowledgement and a failed local import reconcile the same mission and preserve its native draft identity',
  { timeout: 240000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const remote = new Map();
    let submitted = 0,
      failImport = false,
      failGeneration = false;
    const faultyPool = {
      query: (...args) => pool.query(...args),
      async connect() {
        const db = await pool.connect();
        return {
          async query(sql, ...args) {
            if (
              failImport &&
              typeof sql === 'string' &&
              sql.startsWith('INSERT INTO preflight_workshop_proposals')
            ) {
              failImport = false;
              throw new Error('Synthetic interrupted local import');
            }
            return db.query(sql, ...args);
          },
          release: () => db.release()
        };
      }
    };
    const client = {
      async notifySourceUpdate() {
        return { duplicate: false, invalidated: 0 };
      },
      async getMission(id) {
        if (!remote.has(id))
          throw new PreflightClientError('preflight_http_error', false, 404);
        return remote.get(id);
      },
      async submit(mission) {
        submitted++;
        const detail = workshopRemoteDetail(mission);
        if (failGeneration) {
          detail.mission.status = 'failed';
          detail.proposals = [];
        }
        remote.set(mission.missionId, detail);
        if (submitted === 1)
          throw new PreflightClientError('preflight_timeout', true);
        return { mission: detail.mission, duplicate: false };
      }
    };
    const id = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name,
    sponsor_contact_email,sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
    VALUES('sponsorship_interest',25000,'CAD','paid',NOW(),'Synthetic automatic partner','private@example.invalid','Existing public source',TRUE,'approved',TRUE) RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, id, {
      channels: ['website', 'facebook']
    });
    const native = await withPostgresTransaction(pool, (db) =>
      createAdminPublicationDraftOnConnection(
        db,
        { contributionId: id, feedTarget: 'openg7', channel: 'facebook' },
        'synthetic'
      )
    );
    const service = new PublicationWorkshopService(faultyPool, config, {
      client
    });
    await service.tick();
    const initial = await service.read(id);
    assert.equal(initial.mission.delivery, 'uncertain');
    assert.equal(submitted, 1);
    failImport = true;
    await pool.query(
      'UPDATE preflight_workshop_missions SET next_attempt_at=NOW()'
    );
    await service.tick();
    assert.equal(
      (await service.read(id)).mission.delivery,
      'uncertain',
      'acknowledged remote work survives a transient local storage error'
    );
    assert.equal(submitted, 1);
    await pool.query(
      'UPDATE preflight_workshop_missions SET next_attempt_at=NOW()'
    );
    await new PublicationWorkshopService(faultyPool, config, { client }).tick();
    const recovered = await service.read(id);
    assert.equal(recovered.mission.id, initial.mission.id);
    assert.ok(recovered.proposal);
    assert.equal(submitted, 1);
    await service.adopt(
      {
        contributionId: id,
        proposalId: recovered.proposal.id,
        expectedSourceVersion: 1,
        requestId: randomUUID()
      },
      'synthetic'
    );
    const rows = (
      await pool.query(
        'SELECT id,body,status,approved_at FROM sponsor_publication_drafts WHERE contribution_id=$1',
        [id]
      )
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, native.draft.id);
    assert.equal(rows[0].body, 'Synthetic proposal for explicit human review');
    assert.equal(rows[0].status, 'draft');
    assert.equal(rows[0].approved_at, null);
    failGeneration = true;
    await service.tick();
    const failed = await service.read(id);
    assert.equal(failed.mission.delivery, 'failed');
    assert.equal(failed.mission.errorCode, 'PREFLIGHT_GENERATION_FAILED');
    assert.equal(failed.proposal, null);
    failGeneration = false;
    const regenerate = {
      contributionId: id,
      expectedSourceVersion: failed.sourceVersion,
      requestId: randomUUID()
    };
    const next = await service.prepare(regenerate, 'synthetic');
    assert.equal(next.sourceVersion, failed.sourceVersion + 1);
    assert.equal(
      (await service.prepare(regenerate, 'synthetic')).mission.id,
      next.mission.id,
      'explicit regeneration is idempotent'
    );
    await service.tick();
    assert.ok((await service.read(id)).proposal);
    const many = (
      await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      public_display_consent,sponsor_site_visibility_held) VALUES('sponsorship_interest',25000,'CAD','paid',NOW(),FALSE,TRUE) RETURNING id`)
    ).rows[0].id;
    await recordFixtureSponsorshipAgreement(pool, many, {
      benefits: [
        { channel: 'website', target: 'openg7', quantity: 1 },
        { channel: 'facebook', target: 'openg7', quantity: 21 }
      ]
    });
    await service.tick();
    const passages = await service.read(many);
    assert.equal(
      passages.proposal.editorialPreparation.variants.length,
      2,
      'preparation targets the next passage per destination without exceeding transport limits'
    );
    const firstPassage = passages.proposal.editorialPreparation.variants.find(
      (v) => v.destination === 'facebook'
    ).obligationId;
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM sponsorship_obligations WHERE contribution_id=$1',
          [many]
        )
      ).rows[0].n,
      22,
      'all promises remain recorded'
    );
    await pool.query(
      "UPDATE sponsorship_obligations SET state='adjusted',version=version+1 WHERE id=$1",
      [firstPassage]
    );
    await service.tick();
    const following = await service.read(many);
    assert.notEqual(
      following.proposal.editorialPreparation.variants.find(
        (v) => v.destination === 'facebook'
      ).obligationId,
      firstPassage
    );
    assert.equal(following.sourceVersion, passages.sourceVersion + 1);
  }
);
