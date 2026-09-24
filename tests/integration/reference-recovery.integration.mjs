import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listContributionReferencesByEmail,
  lookupPublicContributionReference
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'reference recovery is bounded to the matching address; public lookup respects amount consent and never grants private access',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres();
    try {
      await pool.query(`INSERT INTO fund_contributions (
      contribution_type, amount_cents, currency, status, email_private,
      public_reference, paid_at, public_name, display_amount_consent
    ) SELECT 'personal_support', 2500, 'cad', 'paid', 'Owner@simulation.example.test',
      'OG7-2026-R' || LPAD(n::text, 7, '0'),
      TIMESTAMPTZ '2026-08-01 00:00:00+00' + n * INTERVAL '1 minute',
      'Synthetic contributor', n=30 FROM generate_series(1,30) n`);
      await pool.query(`INSERT INTO fund_contributions (
      contribution_type, amount_cents, currency, status, email_private,
      sponsor_contact_email, public_reference, sponsor_company_name,
      sponsor_message, sponsorship_followup_token_hash, sponsor_review_status
    ) VALUES ('sponsorship_interest', 25000, 'cad', 'paid',
      'payer@simulation.example.test', 'contact@simulation.example.test',
      'OG7-2026-CONTACT', 'Synthetic company', 'Private dossier note',
      'synthetic-hash-not-a-token', 'pending_review')`);
      await pool.query(`INSERT INTO fund_contributions (
      contribution_type, amount_cents, currency, status, email_private
    ) VALUES ('personal_support', 2500, 'cad', 'paid', 'Owner@simulation.example.test')`);
      const facts = async () =>
        (await pool.query('SELECT * FROM fund_contributions ORDER BY id')).rows;
      const before = await facts();

      const references = await listContributionReferencesByEmail(
        pool,
        '  OWNER@simulation.example.test  '
      );
      assert.equal(references.length, 25);
      assert.deepEqual(
        references.map((r) => r.publicReference),
        Array.from(
          { length: 25 },
          (_, i) => 'OG7-2026-R' + String(30 - i).padStart(7, '0')
        )
      );
      assert.deepEqual(
        await listContributionReferencesByEmail(
          pool,
          'unknown@simulation.example.test'
        ),
        []
      );
      assert.deepEqual(
        await listContributionReferencesByEmail(
          pool,
          '%@simulation.example.test'
        ),
        []
      );
      assert.deepEqual(await listContributionReferencesByEmail(pool, ''), []);
      assert.deepEqual(
        await listContributionReferencesByEmail(
          null,
          'owner@simulation.example.test'
        ),
        []
      );
      const paymentReferences = await listContributionReferencesByEmail(
        pool,
        'payer@simulation.example.test'
      );
      const contactReferences = await listContributionReferencesByEmail(
        pool,
        'contact@simulation.example.test'
      );
      assert.equal(paymentReferences.length, 1);
      assert.deepEqual(contactReferences, paymentReferences);
      assert.equal(contactReferences[0].publicReference, 'OG7-2026-CONTACT');
      for (const privateValue of [
        'Private dossier note',
        'synthetic-hash-not-a-token',
        'email_private',
        'sponsor_contact_email'
      ]) {
        assert.equal(
          JSON.stringify(contactReferences).includes(privateValue),
          false
        );
      }

      const hidden = await lookupPublicContributionReference(
        pool,
        'OG7-2026-R0000029'
      );
      const visible = await lookupPublicContributionReference(
        pool,
        'OG7-2026-R0000030'
      );
      assert.equal(hidden.amount, null);
      assert.equal(hidden.displayAmount, false);
      assert.equal(visible.amount, 25);
      assert.equal(visible.displayAmount, true);
      const company = await lookupPublicContributionReference(
        pool,
        'OG7-2026-CONTACT'
      );
      assert.deepEqual(
        Object.keys(company).sort(),
        [
          'found',
          'publicReference',
          'contributionType',
          'paymentStatus',
          'amount',
          'displayAmount',
          'currency',
          'paidAt',
          'createdAt',
          'reviewStatus',
          'detailsSubmitted',
          'nextStep'
        ].sort()
      );
      assert.equal(company.nextStep, 'recover_private_link_by_email');
      assert.equal(company.amount, null);
      assert.equal(company.reviewStatus, 'pending_review');
      assert.equal(company.detailsSubmitted, false);
      assert.equal(
        await lookupPublicContributionReference(pool, 'OG7-2026-MISSING'),
        null
      );
      assert.deepEqual(
        await facts(),
        before,
        'recovery and public lookup are read-only financial operations'
      );
    } finally {
      await stop();
    }
  }
);
