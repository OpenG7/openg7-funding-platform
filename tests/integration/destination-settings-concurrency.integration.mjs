import assert from 'node:assert/strict';
import test from 'node:test';
import { command } from '../../dist/apps/funding-api/src/publication-automation/commands.js';
import { samePublicationFeedSettings } from '../../dist/packages/funding-core/src/index.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'destination settings serialize competing administrators, replay without another effect and roll back audit failures',
  { timeout: 90000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const context = { pool };
    const read = async () =>
      (
        await pool.query(
          `SELECT id,paused,auto_prepare AS "autoPrepare",timezone,weekdays,to_char(local_time,'HH24:MI') AS "localTime",capacity,horizon_days AS "horizonDays" FROM publication_feeds WHERE id='openg7:facebook'`
        )
      ).rows[0];
    const baseline = await read();
    await assert.rejects(
      command(
        context,
        { action: 'settings', settings: baseline },
        'synthetic-legacy-client'
      ),
      (error) =>
        error.code === 'SETTINGS_PRECONDITION_REQUIRED' && error.status === 428
    );
    assert.ok(samePublicationFeedSettings(await read(), baseline));
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS total FROM admin_audit_log WHERE action='publication_automation.settings'"
        )
      ).rows[0].total,
      0
    );
    const targets = [1, 2, 3]
      .filter((value) => value !== baseline.capacity)
      .slice(0, 2);
    const commands = targets.map((capacity) => ({
      action: 'settings',
      expectedSettings: baseline,
      settings: { ...baseline, capacity }
    }));
    const results = await Promise.allSettled(
      commands.map((input, index) =>
        command(context, input, `synthetic-admin-${index}`)
      )
    );
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1
    );
    const loser = results.find((result) => result.status === 'rejected');
    assert.equal(loser.reason.code, 'SETTINGS_CONFLICT');
    assert.equal(loser.reason.status, 409);
    const winner =
      commands[results.findIndex((result) => result.status === 'fulfilled')];
    assert.ok(samePublicationFeedSettings(await read(), winner.settings));
    await command(context, winner, 'synthetic-replay');
    const audits = await pool.query(
      `SELECT actor,entity_type,metadata FROM admin_audit_log WHERE action='publication_automation.settings'`
    );
    assert.equal(audits.rowCount, 1);
    assert.equal(audits.rows[0].entity_type, 'publication_feed');
    assert.deepEqual(audits.rows[0].metadata.previous, baseline);

    await pool.query(`CREATE FUNCTION fail_destination_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit unavailable'; END $$;
    CREATE TRIGGER fail_destination_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW WHEN (NEW.entity_type='publication_feed') EXECUTE FUNCTION fail_destination_audit()`);
    const saved = await read();
    await assert.rejects(
      command(
        context,
        {
          action: 'settings',
          expectedSettings: saved,
          settings: { ...saved, capacity: baseline.capacity }
        },
        'synthetic-audit-failure'
      ),
      /synthetic audit unavailable/
    );
    assert.ok(samePublicationFeedSettings(await read(), saved));
    await pool.query('DROP TRIGGER fail_destination_audit ON admin_audit_log');

    await pool.query(
      "UPDATE publication_feeds SET paused=FALSE WHERE id='openg7:facebook'"
    );
    const beforePause = await read();
    await command(context, { action: 'pause-all' }, 'synthetic-stop');
    await assert.rejects(
      command(
        context,
        {
          action: 'settings',
          expectedSettings: beforePause,
          settings: { ...beforePause, capacity: baseline.capacity }
        },
        'synthetic-stale-admin'
      ),
      (error) => error.code === 'SETTINGS_CONFLICT'
    );
    assert.equal((await read()).paused, true);
  }
);
