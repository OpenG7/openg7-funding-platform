import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

import { searchAdmin } from '../../dist/apps/funding-api/src/admin-search.service.js';
import { listAdminContributions } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';

test(
  'global search groups and paginates actual PostgreSQL records with literal, private input',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    try {
      assert.equal(
        (await pool.query("SELECT to_regclass('fund_contributions') AS name"))
          .rows[0].name,
        null,
        'fresh disposable database required'
      );
      for (const file of (await readdir('apps/funding-api/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort())
        await pool.query(
          await readFile('apps/funding-api/migrations/' + file, 'utf8')
        );
      assert.deepEqual(
        (await searchAdmin(pool, { query: 'Nothing' })).groups,
        []
      );
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, sponsor_company_name)
      SELECT 'sponsorship_interest', 10000, 'cad', 'paid', '2026-09-01', 'Fixture ' || i FROM generate_series(1,2005) i`);
      const id = (
        await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at,
      sponsor_company_name, email_private, sponsor_contact_email, public_reference, sponsor_public_slug, stripe_session_id, stripe_payment_intent_id, sponsorship_refund_id)
      VALUES ('sponsorship_interest', 10050, 'cad', 'paid', '2020-01-01', 'Acme', 'private@example.invalid', 'contact@example.invalid',
        'OG7-SEARCH', 'acme-search', 'cs_search', 'pi_search', 're_search') RETURNING id`)
      ).rows[0].id;
      const invoiceId = (
        await pool.query(
          `INSERT INTO sponsorship_invoices (contribution_id, invoice_number, stripe_session_id, currency,
      subtotal_cents, total_cents, issuer_name, sponsor_name, sponsor_contact_email)
      VALUES ($1,'FAC-SEARCH','cs_invoice_search','cad',10050,10050,'Fixture','Acme','snapshot@example.invalid') RETURNING id`,
          [id]
        )
      ).rows[0].id;
      const draftIds = [];
      for (const channel of ['facebook', 'linkedin']) {
        draftIds.push(
          (
            await pool.query(
              `INSERT INTO sponsor_publication_drafts (contribution_id, feed_target, channel, title, body, disclosure_text)
        VALUES ($1,'openg7',$2,'Acme publication','private body','notice') RETURNING id`,
              [id, channel]
            )
          ).rows[0].id
        );
      }
      const exact = async (query) => {
        const result = await searchAdmin(pool, { query });
        assert.equal(result.total, 1, query);
        assert.equal(result.groups[0].contributionId, id, query);
        assert.equal(result.groups[0].invoice.id, invoiceId);
        assert.deepEqual(
          result.groups[0].publications.map((p) => p.id),
          draftIds
        );
        assert.equal(result.available, true);
        assert.deepEqual(result.missingSources, []);
        assert.ok(!JSON.stringify(result).includes('@example.invalid'));
        assert.ok(!JSON.stringify(result).includes('private body'));
      };
      for (const query of [
        'Acme',
        'PRIVATE@example.invalid',
        'contact@example.invalid',
        'snapshot@example.invalid',
        'OG7-SEARCH',
        'acme-search',
        'cs_search',
        'pi_search',
        're_search',
        'FAC-SEARCH',
        invoiceId,
        draftIds[0],
        id,
        '100,50 CAD',
        'CAD 100.50',
        '100.50'
      ])
        await exact(query);
      assert.equal((await searchAdmin(pool, { query: '100.50 USD' })).total, 0);
      assert.equal(
        (await searchAdmin(pool, { query: "' OR TRUE --" })).total,
        0
      );
      for (const query of ['Literal%_', 'Literal\\value']) {
        await pool.query(
          'UPDATE fund_contributions SET sponsor_company_name = $1 WHERE id = $2',
          [query, id]
        );
        await exact(query);
      }
      await pool.query(
        "UPDATE fund_contributions SET sponsor_company_name = 'Acme' WHERE id = $1",
        [id]
      );
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, sponsor_company_name)
      VALUES ('personal_support',29,'usd','Acme Prefix'), ('personal_support',29,'usd','Contains Acme')`);
      const ranked = await searchAdmin(pool, { query: 'Acme', pageSize: 1 });
      assert.equal(ranked.total, 3);
      assert.equal(ranked.groups[0].title, 'Acme');
      assert.equal(
        (await searchAdmin(pool, { query: 'Acme', pageSize: 1, page: 2 }))
          .groups[0].title,
        'Acme Prefix'
      );
      assert.equal(
        (await searchAdmin(pool, { query: 'Acme', pageSize: 1, page: 3 }))
          .groups[0].title,
        'Contains Acme'
      );
      const beyond = await searchAdmin(pool, {
        query: 'Acme',
        pageSize: 1,
        page: 4
      });
      assert.equal(beyond.total, 3);
      assert.deepEqual(beyond.groups, []);
      assert.equal(
        (await searchAdmin(pool, { query: '100 CAD', pageSize: 20 })).total,
        2005
      );
      assert.equal((await searchAdmin(pool, { query: '0.29 USD' })).total, 2);
      const first = await searchAdmin(pool, { query: 'Fixture', pageSize: 20 });
      const second = await searchAdmin(pool, {
        query: 'Fixture',
        pageSize: 20,
        page: 2
      });
      assert.equal(first.total, 2005);
      assert.equal(
        new Set(
          [...first.groups, ...second.groups].map((g) => g.contributionId)
        ).size,
        40
      );
      assert.deepEqual(
        (await searchAdmin(pool, { query: 'Fixture', pageSize: 20 })).groups,
        first.groups
      );
      assert.ok(
        !(await listAdminContributions(pool)).contributions.some(
          (c) => c.id === id
        )
      );
      const scoped = await listAdminContributions(pool, id);
      assert.equal(scoped.contributions.length, 1);
      assert.equal(scoped.contributions[0].id, id);
      // Measure the actual production SQL, not a simplified stand-in query.
      let plan;
      const measuredPool = {
        connect: async () => {
          const client = await pool.connect();
          return {
            release: () => client.release(),
            query: async (sql, params) => {
              if (sql.trim().startsWith('WITH hits'))
                plan = (
                  await client.query(
                    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql,
                    params
                  )
                ).rows[0]['QUERY PLAN'][0];
              return client.query(sql, params);
            }
          };
        }
      };
      await searchAdmin(measuredPool, { query: 'FAC-SEARCH' });
      t.diagnostic(
        'Search plan on 2008 contributions: ' +
          JSON.stringify({
            planningMs: plan['Planning Time'],
            executionMs: plan['Execution Time']
          })
      );
      const before = (
        await pool.query(
          'SELECT (SELECT count(*) FROM email_messages) AS mail, (SELECT count(*) FROM admin_audit_log) AS audit'
        )
      ).rows[0];
      await exact('Acme publication');
      assert.deepEqual(
        (
          await pool.query(
            'SELECT (SELECT count(*) FROM email_messages) AS mail, (SELECT count(*) FROM admin_audit_log) AS audit'
          )
        ).rows[0],
        before
      );
      await pool.query(
        'ALTER TABLE sponsorship_invoices RENAME TO search_test_invoices'
      );
      const partial = await searchAdmin(pool, { query: 'Acme' });
      assert.equal(partial.available, true);
      assert.deepEqual(partial.missingSources, ['sponsorship_invoices']);
      assert.equal(partial.groups[0].invoice, null);
      await pool.query(
        'ALTER TABLE fund_contributions RENAME TO search_test_contributions'
      );
      assert.equal(
        (await searchAdmin(pool, { query: 'Acme' })).available,
        false
      );
    } finally {
      await stop();
    }
  }
);
