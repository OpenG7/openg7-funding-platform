import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { listAdminContributions } from '../../dist/apps/funding-api/src/contributions-read.repository.js';
import { getAdminDashboard } from '../../dist/apps/funding-api/src/contributions-dashboard.repository.js';
import { listAdminExpenses } from '../../dist/apps/funding-api/src/fund-expenses.repository.js';
import { listAdminSponsorshipInvoices } from '../../dist/apps/funding-api/src/sponsorship-documents/invoices.read.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const conflict = {
  name: 'AdminFinancialCurrencyConflictError',
  status: 409,
  code: 'ADMIN_FINANCIAL_CURRENCY_CONFLICT'
};

test(
  'scalar admin summaries reject mixed currencies without altering financial facts',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    let db;
    t.after(async () => {
      db?.release();
      await database.stop();
    });
    db = await database.pool.connect();
    const isolated = (name, operation) =>
      t.test(name, async () => {
        await db.query('BEGIN');
        try {
          await operation();
        } finally {
          await db.query('ROLLBACK');
        }
      });
    const contribution = async (currency, status = 'paid') =>
      (
        await db.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,stripe_session_id)
     VALUES('sponsorship_interest',1000,$1,$2,$3) RETURNING id`,
          [currency, status, 'cs_synthetic_currency_' + randomUUID()]
        )
      ).rows[0].id;
    const invoice = async (currency) => {
      const id = await contribution(currency);
      return (
        await db.query(
          `INSERT INTO sponsorship_invoices(contribution_id,invoice_number,stripe_session_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
       VALUES($1,$2,$3,$4,1000,1000,'Synthetic issuer','Synthetic sponsor') RETURNING *`,
          [
            id,
            'SYNTHETIC-' + randomUUID(),
            'cs_invoice_' + randomUUID(),
            currency
          ]
        )
      ).rows[0];
    };
    const adjustment = (currency, type = 'charge.refunded') =>
      db.query(
        `INSERT INTO fund_transactions(stripe_event_id,stripe_object_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json)
     VALUES($1,$2,$3,50,0,$4,$5,$6,NOW(),'synthetic',$7::jsonb)`,
        [
          'evt_currency_' + randomUUID(),
          'obj_currency_' + randomUUID(),
          type,
          type === 'charge.refunded' ? -50 : 50,
          currency,
          type === 'charge.refunded' ? 'succeeded' : 'paid',
          JSON.stringify({ refundId: 're_currency_' + randomUUID() })
        ]
      );

    await isolated(
      'confirmed CAD and USD never become a scalar total or legacy dashboard',
      async () => {
        await contribution('cad');
        await contribution('usd');
        const before = (
          await db.query(
            'SELECT id,amount_cents,currency,status FROM fund_contributions ORDER BY id'
          )
        ).rows;
        await assert.rejects(listAdminContributions(db), conflict);
        await assert.rejects(getAdminDashboard(db), conflict);
        assert.deepEqual(
          (
            await db.query(
              'SELECT id,amount_cents,currency,status FROM fund_contributions ORDER BY id'
            )
          ).rows,
          before
        );
      }
    );
    await isolated(
      'pending foreign currencies and unrelated payouts do not relabel confirmed amounts',
      async () => {
        await contribution('CAD');
        await contribution('cad');
        await contribution('usd', 'pending');
        await adjustment('usd', 'payout.paid');
        const result = await listAdminContributions(db);
        assert.equal(result.summary.total_received, 20);
        assert.equal(result.summary.currency, 'CAD');
        assert.equal(result.summary.pending_count, 1);
        assert.equal(
          result.contributions.filter((row) => row.currency === 'USD').length,
          1
        );
      }
    );
    await isolated(
      'ledger refunds must share one currency with confirmed contributions',
      async () => {
        await contribution('cad');
        await adjustment('usd');
        await assert.rejects(listAdminContributions(db), conflict);
        await adjustment('cad');
        await assert.rejects(listAdminContributions(db), conflict);
      }
    );
    await isolated(
      'a single ledger-refund currency is retained when no payment is confirmed',
      async () => {
        await contribution('cad', 'pending');
        await adjustment('usd');
        const result = await listAdminContributions(db);
        assert.equal(result.summary.currency, 'USD');
        assert.equal(result.summary.total_received, 0);
        assert.equal(result.summary.total_refunded, 0.5);
      }
    );
    await isolated(
      'invoice totals reject mixed currencies before returning any document summary',
      async () => {
        await invoice('cad');
        await invoice('usd');
        await assert.rejects(listAdminSponsorshipInvoices(db), conflict);
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM sponsorship_invoices'
            )
          ).rows[0].n,
          2
        );
      }
    );
    await isolated(
      'credit-note currency cannot be added to an invoice in another currency',
      async () => {
        const issued = await invoice('cad');
        await db.query(
          `INSERT INTO sponsorship_credit_notes(invoice_id,contribution_id,credit_note_number,invoice_number,stripe_refund_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
       VALUES($1,$2,$3,$4,$5,'usd',50,50,'Synthetic issuer','Synthetic sponsor')`,
          [
            issued.id,
            issued.contribution_id,
            'SYNTHETIC-' + randomUUID(),
            issued.invoice_number,
            're_note_' + randomUUID()
          ]
        );
        await assert.rejects(listAdminSponsorshipInvoices(db), conflict);
      }
    );
    await isolated(
      'same-currency invoices and credit notes retain exact scalar totals',
      async () => {
        const issued = await invoice('cad');
        await db.query(
          `INSERT INTO sponsorship_credit_notes(invoice_id,contribution_id,credit_note_number,invoice_number,stripe_refund_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
       VALUES($1,$2,$3,$4,$5,'CAD',50,50,'Synthetic issuer','Synthetic sponsor')`,
          [
            issued.id,
            issued.contribution_id,
            'SYNTHETIC-' + randomUUID(),
            issued.invoice_number,
            're_note_' + randomUUID()
          ]
        );
        const result = await listAdminSponsorshipInvoices(db);
        assert.equal(result.summary.currency, 'CAD');
        assert.equal(result.summary.total_amount, 10);
        assert.equal(result.summary.total_credited, 0.5);
      }
    );
    await isolated(
      'historical mixed allocations fail explicitly; archived amounts never relabel active CAD',
      async () => {
        await db.query(`INSERT INTO fund_allocations(project_name,public_description,amount_allocated,currency,status)
      VALUES('Synthetic CAD','Synthetic',1000,'cad','draft'),('Synthetic USD','Synthetic',500,'usd','private')`);
        await assert.rejects(listAdminExpenses(db), conflict);
        await db.query(
          "UPDATE fund_allocations SET status='archived' WHERE currency='usd'"
        );
        const result = await listAdminExpenses(db);
        assert.equal(result.summary.total_allocated, 10);
        assert.equal(result.summary.currency, 'CAD');
        assert.equal(result.summary.archived_count, 1);
        assert.equal(result.expenses.length, 2);
      }
    );
  }
);
