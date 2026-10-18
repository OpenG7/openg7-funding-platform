import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { readMediaHistory } from '../../dist/apps/funding-api/src/sponsor-media-workspace/history.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'media timeline pages owning evidence without leaking another dossier or duplicating rights audit',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const createDossier = async () =>
      (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status) VALUES('sponsorship_interest',10000,'cad','paid') RETURNING id`
        )
      ).rows[0].id;
    const contributionId = await createDossier();
    const foreignId = await createDossier();
    for (let index = 0; index < 55; index++) {
      await pool.query(
        `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
      VALUES('synthetic-reviewer','sponsorship.media.workspace.batch','sponsorship',$1,$2,'{}')`,
        [contributionId, 'Synthetic operation ' + index]
      );
    }
    await pool.query(
      `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
    VALUES('foreign-actor','sponsorship.media.workspace.batch','sponsorship',$1,'Foreign private operation','{}')`,
      [foreignId]
    );
    await pool.query(
      `INSERT INTO sponsor_media_rule_versions(contribution_id,scope_type,scope_id,revision,usage_rights,evidence_reference,authorization_scope,covered_asset_ids,actor,request_id)
    VALUES($1,'dossier',$1,1,$2::jsonb,'Synthetic private rights source','scope','{}','synthetic-reviewer',$3)`,
      [
        contributionId,
        JSON.stringify({
          state: 'confirmed',
          channels: ['website'],
          targets: ['openg7'],
          transformations: ['technical'],
          credit: null,
          restrictions: null
        }),
        randomUUID()
      ]
    );
    const first = await readMediaHistory(pool, contributionId);
    assert.equal(first.entries.length, 50);
    assert.ok(first.nextCursor);
    const second = await readMediaHistory(
      pool,
      contributionId,
      undefined,
      first.nextCursor
    );
    assert.equal(second.nextCursor, null);
    const all = [...first.entries, ...second.entries];
    assert.equal(all.length, 56);
    assert.equal(new Set(all.map((entry) => entry.id)).size, 56);
    assert.ok(
      all.some(
        (entry) => entry.evidenceReference === 'Synthetic private rights source'
      )
    );
    assert.ok(all.every((entry) => entry.actor === 'synthetic-reviewer'));
    await assert.rejects(
      readMediaHistory(pool, contributionId, undefined, 'not-a-cursor'),
      { code: 'INVALID_MEDIA_HISTORY_REQUEST' }
    );
  }
);
