import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { SponsorshipCommitmentRecord } from '@openg7/funding-core';
import sharp from 'sharp';

import { captureWebsiteEvidenceSnapshot } from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { attestWebsiteMedia } from '../../dist/apps/funding-api/src/sponsorship-website-media.js';
import { approveCurrentModeration } from '../playwright/support/moderation.js';

import { startIdentityStack } from './stack.mjs';
import { signInAdminIdentity } from './support/admin-browser.js';

const base = '/api/admin/sponsorship-commitments';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

test('owner records historical terms, amends one obligation and attests a documented duration with persistent rights and replay guards', async ({
  playwright
}, info) => {
  test.setTimeout(180000);
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  try {
    const { pool, origin } = stack;
    const id = randomUUID();
    const mediaId = randomUUID();
    const commitmentId = randomUUID();
    await pool.query(
      `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,public_reference,sponsor_company_name,sponsor_public_summary,sponsor_review_status,public_display_consent,non_charity_acknowledged,sponsor_site_visibility_held)
       VALUES($1,'sponsorship_interest',50000,'cad','paid','2026-09-01T12:00:00Z','OG7-2026-OWNR0001','Synthetic owner agreement','Synthetic public presentation','approved',TRUE,TRUE,TRUE)`,
      [id]
    );
    await pool.query(
      `INSERT INTO sponsorship_commitments(id,contribution_id,provenance,state)
       VALUES($1,$2,'historical_unverified','needs_confirmation')`,
      [commitmentId, id]
    );
    const financialFacts = async () =>
      (
        await pool.query(
          'SELECT amount_cents,currency,status,paid_at FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0];
    const originalFinancialFacts = await financialFacts();
    const open = async (role = 'owner', width = 1280) => {
      const context = await playwright.chromium.launchPersistentContext(
        await mkdtemp(join(tmpdir(), 'og7-owner-obligation-')),
        {
          baseURL: origin,
          viewport: { width, height: 1000 },
          timezoneId: 'America/Toronto'
        }
      );
      contexts.push(context);
      const page = context.pages()[0] ?? (await context.newPage());
      await signInAdminIdentity(
        page,
        '/admin/fundraiser/sponsors?sponsorshipId=' + id + '&tab=publication',
        role
      );
      await expect(hook(page, 'admin-commitments')).toBeVisible();
      return page;
    };
    const owner = await open();
    const errors: string[] = [];
    owner.on('pageerror', (error) => errors.push(error.message));
    const headers = { Origin: origin };
    const read = async () => {
      const response = await owner.request.get(base + '?contributionId=' + id);
      expect(response.status()).toBe(200);
      return (
        (await response.json()) as { commitment: SponsorshipCommitmentRecord }
      ).commitment;
    };
    const commercialAudits = async () =>
      (
        await pool.query(
          "SELECT actor,action,metadata FROM admin_audit_log WHERE entity_id=$1 AND action LIKE 'sponsorship_commitment.%' ORDER BY created_at,id",
          [id]
        )
      ).rows;
    const addBenefit = async (
      index: number,
      channel: string,
      days?: { deadline: string; duration: string }
    ) => {
      await hook(owner, 'commitments-add-benefit').click();
      await hook(owner, 'commitments-benefit-channel')
        .nth(index)
        .selectOption(channel);
      await hook(owner, 'commitments-benefit-target')
        .nth(index)
        .selectOption('openg7');
      await hook(owner, 'commitments-benefit-quantity').nth(index).fill('1');
      await hook(owner, 'commitments-company-required').nth(index).check();
      if (channel !== 'website')
        await hook(owner, 'commitments-benefit-format').selectOption(
          'collective_text'
        );
      if (days) {
        await hook(owner, 'commitments-deadline')
          .nth(index)
          .fill(days.deadline);
        await hook(owner, 'commitments-duration')
          .nth(index)
          .fill(days.duration);
      }
    };
    await addBenefit(0, 'website', { deadline: '7', duration: '1' });
    await addBenefit(1, 'facebook');
    await hook(owner, 'commitments-evidence').fill(
      'synthetic://original-agreement/owner-record'
    );
    await hook(owner, 'commitments-reason').fill(
      'Synthetic historical terms independently checked by the owner.'
    );
    await hook(owner, 'commitments-confirmation').fill('wrong-confirmation');
    await hook(owner, 'commitments-qualify').click();
    await expect(hook(owner, 'commitments-error')).toBeVisible();
    expect((await read()).state).toBe('needs_confirmation');
    expect(await commercialAudits()).toHaveLength(0);

    await hook(owner, 'commitments-confirmation').fill(id);
    let qualification: Record<string, unknown> | undefined;
    await owner.route(
      '**' + base + '/qualify',
      async (route) => {
        qualification = route.request().postDataJSON();
        const response = await route.fetch({ maxRetries: 0 });
        expect(response.status()).toBe(200);
        await route.abort('failed');
      },
      { times: 1 }
    );
    await hook(owner, 'commitments-qualify').click();
    await expect(hook(owner, 'commitments-retry')).toBeVisible();
    await expect(hook(owner, 'commitments-retry')).toBeEnabled();
    expect((await read()).state).toBe('active');
    expect(await commercialAudits()).toHaveLength(1);
    const repeated = owner.waitForResponse(
      (response) =>
        response.url().endsWith(base + '/qualify') &&
        response.request().method() === 'POST'
    );
    await hook(owner, 'commitments-retry').click();
    const replay = await repeated;
    expect(replay.status()).toBe(200);
    expect(replay.request().postDataJSON()).toEqual(qualification);
    await expect(hook(owner, 'commitments-accepted-offer')).toBeVisible();
    expect(await commercialAudits()).toHaveLength(1);
    const qualified = await read();
    expect(qualified).toMatchObject({
      provenance: 'qualified_historical',
      state: 'active',
      version: 2
    });
    expect(qualified.offer).toMatchObject({
      version: 'historical-qualification-v1',
      amountMinor: 50000,
      currency: 'CAD'
    });
    expect(qualified.obligations).toHaveLength(2);
    expect(
      (
        await pool.query(
          'SELECT sponsor_site_visibility_held AS held FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0].held
    ).toBe(true);
    const originalOffer = (
      await pool.query(
        'SELECT id,version,fingerprint,snapshot FROM sponsorship_offers WHERE id=$1',
        [qualified.offerId]
      )
    ).rows[0];
    const website = qualified.obligations.find(
      (obligation) => obligation.channel === 'website'
    )!;
    const social = qualified.obligations.find(
      (obligation) => obligation.channel === 'facebook'
    )!;

    for (const role of ['operator', 'reader']) {
      expect(
        (
          await owner.request.post('/api/admin/access', {
            headers,
            data: {
              subject: 'fixture-' + role,
              confirmation: 'fixture-' + role,
              displayName: 'Synthetic ' + role,
              role,
              disabled: false
            }
          })
        ).status()
      ).toBe(200);
      const restricted = await open(role, role === 'reader' ? 390 : 1280);
      await expect(hook(restricted, 'commitments-adjust-open')).toHaveCount(0);
      await expect(hook(restricted, 'commitments-qualification')).toHaveCount(
        0
      );
      for (const endpoint of ['/qualify', '/adjust', '/timing']) {
        const response = await restricted.request.post(base + endpoint, {
          headers,
          data:
            endpoint === '/qualify'
              ? qualification
              : {
                  requestId: randomUUID(),
                  obligationId: social.id,
                  expectedVersion: 1,
                  confirmation: social.id,
                  kind: 'destination',
                  target: 'openg20',
                  reason: 'Synthetic forbidden request.'
                }
        });
        expect(response.status()).toBe(403);
      }
    }
    expect(await commercialAudits()).toHaveLength(1);

    const staleOwner = await open();
    const editDestination = async (page: Page) => {
      const obligation = hook(page, 'commitments-obligations').locator(
        `[data-og7-id="${social.id}"]`
      );
      await obligation.locator('[data-og7="commitments-adjust-open"]').click();
      await hook(page, 'commitments-adjust-kind').selectOption('destination');
      await hook(page, 'commitments-adjust-target').selectOption('openg20');
      await hook(page, 'commitments-adjust-reason').fill(
        'Synthetic owner amendment to the outstanding destination.'
      );
      await hook(page, 'commitments-adjust-confirmation').fill(social.id);
    };
    await editDestination(staleOwner);
    await editDestination(owner);
    const adjusted = owner.waitForResponse((response) =>
      response.url().endsWith(base + '/adjust')
    );
    await hook(owner, 'commitments-adjust-save').click();
    expect((await adjusted).status()).toBe(200);
    expect(
      (await read()).obligations.find(
        (obligation) => obligation.id === social.id
      )
    ).toMatchObject({ target: 'openg20', version: 2, state: 'blocked' });
    const rejected = staleOwner.waitForResponse((response) =>
      response.url().endsWith(base + '/adjust')
    );
    await hook(staleOwner, 'commitments-adjust-save').click();
    const conflict = await rejected;
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: 'COMMITMENT_VERSION_CONFLICT'
    });
    expect(await commercialAudits()).toHaveLength(2);
    expect(
      (
        await pool.query(
          'SELECT id,version,fingerprint,snapshot FROM sponsorship_offers WHERE id=$1',
          [qualified.offerId]
        )
      ).rows[0]
    ).toEqual(originalOffer);

    await owner.reload();
    const timing = hook(owner, 'sponsorship-timing').filter({
      has: owner.locator(`[id="timing-title-${website.id}"]`)
    });
    await timing.locator('summary').click();
    const originAt = new Date(Date.now() - 2 * 86400000)
      .toISOString()
      .slice(0, 16);
    await timing.locator('[data-og7="timing-origin"]').fill(originAt);
    await timing
      .locator('[data-og7="timing-reason"]')
      .fill('Synthetic owner records the contractual starting point.');
    await timing
      .locator('[data-og7="timing-evidence"]')
      .fill('synthetic://original-agreement/origin');
    await timing.locator('[data-og7="timing-confirmation"]').fill(website.id);
    const anchored = owner.waitForResponse((response) =>
      response.url().endsWith(base + '/timing')
    );
    await timing.locator('[data-og7="timing-record-origin"]').click();
    expect((await anchored).status()).toBe(200);
    const anchoredTiming = (await read()).obligations.find(
      (obligation) => obligation.id === website.id
    )!.timing!;
    expect(anchoredTiming.originAt).toBe(originAt + ':00.000Z');
    expect(anchoredTiming.dueAt).toBe(
      new Date(Date.parse(originAt + ':00Z') + 7 * 86400000).toISOString()
    );

    // Prepare dated historical evidence on this disposable fixture only. This
    // does not claim that the test observed a real two-day public exposure.
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#56789a' }
    })
      .webp()
      .toBuffer();
    const key = 'synthetic-duration/' + mediaId + '/presentation.webp';
    const privateRoot = join(stack.mediaDirectory, 'media-assets', 'private');
    await mkdir(join(privateRoot, 'synthetic-duration', mediaId), {
      recursive: true
    });
    await writeFile(join(privateRoot, ...key.split('/')), bytes);
    await pool.query(
      `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,uploaded_by,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_url,checksum_sha256,width,height,usage_rights)
       VALUES($1,$2,'supporting_image','approved','admin','synthetic.webp','image/webp',$3,$4,$3,$4,$5,$6,40,30,$7::jsonb)`,
      [
        mediaId,
        id,
        bytes.length,
        key,
        '/api/public/sponsor-media/' + mediaId,
        createHash('sha256').update(bytes).digest('hex'),
        JSON.stringify({
          state: 'confirmed',
          channels: ['website'],
          targets: ['openg7'],
          transformations: ['technical'],
          credit: null,
          restrictions: null
        })
      ]
    );
    await approveCurrentModeration(
      owner.request,
      { type: 'media', id: mediaId },
      headers
    );
    await approveCurrentModeration(
      owner.request,
      { type: 'sponsorship', id },
      headers
    );
    await pool.query(
      'UPDATE fund_contributions SET sponsor_site_visibility_held=FALSE WHERE id=$1',
      [id]
    );
    const storage = {
      readPrivateObject: async (name: string) =>
        readFile(join(privateRoot, ...name.split('/')))
    };
    const attestation = await attestWebsiteMedia(pool, storage, id, null);
    const snapshot = await captureWebsiteEvidenceSnapshot(
      pool,
      id,
      ['company_name'],
      attestation
    );
    await pool.query(
      `INSERT INTO sponsorship_website_exposure_observations(obligation_id,contribution_id,obligation_version,content_fingerprint,message,source_snapshot,media_snapshot,observed_at,actor)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,clock_timestamp()-INTERVAL '2 days','synthetic-history-fixture')`,
      [
        website.id,
        id,
        website.version,
        snapshot.fingerprint,
        snapshot.message,
        JSON.stringify(snapshot.sources),
        JSON.stringify(snapshot.media)
      ]
    );
    await owner.reload();
    await timing.locator('summary').click();
    await timing
      .locator('[data-og7="timing-reason"]')
      .fill('Synthetic owner reviewed the documentary continuity evidence.');
    await timing
      .locator('[data-og7="timing-evidence"]')
      .fill('synthetic://private-continuity-record');
    await timing.locator('[data-og7="timing-confirmation"]').fill(website.id);
    await timing.locator('[data-og7="timing-continuity"]').check();
    const completed = owner.waitForResponse((response) =>
      response.url().endsWith(base + '/timing')
    );
    await timing.locator('[data-og7="timing-attest-duration"]').click();
    const completedResponse = await completed;
    expect(completedResponse.status(), await completedResponse.text()).toBe(
      200
    );
    const completedPayload = completedResponse.request().postDataJSON();
    const replayed = await owner.request.post(base + '/timing', {
      headers,
      data: completedPayload
    });
    expect(replayed.status()).toBe(200);
    const after = await read();
    expect(
      after.obligations.find((obligation) => obligation.id === website.id)
    ).toMatchObject({
      state: 'fulfilled',
      timing: { durationState: 'attested' }
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM sponsorship_obligation_duration_attestations WHERE obligation_id=$1',
          [website.id]
        )
      ).rows[0].n
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE obligation_id=$1',
          [website.id]
        )
      ).rows[0].n
    ).toBe(1);
    const audits = await commercialAudits();
    expect(audits.map((row) => row.action)).toEqual([
      'sponsorship_commitment.qualification',
      'sponsorship_commitment.destination',
      'sponsorship_commitment.timing_origin',
      'sponsorship_commitment.duration_attestation'
    ]);
    expect(
      audits.every((row) => /^admin:[a-f0-9-]{36}$/i.test(row.actor))
    ).toBe(true);
    expect(await financialFacts()).toEqual(originalFinancialFacts);
    expect(
      (
        await pool.query(
          'SELECT id,version,fingerprint,snapshot FROM sponsorship_offers WHERE id=$1',
          [qualified.offerId]
        )
      ).rows[0]
    ).toEqual(originalOffer);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM publication_deliveries'
        )
      ).rows[0].n
    ).toBe(0);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM email_messages'))
        .rows[0].n
    ).toBe(0);
    expect(errors).toEqual([]);
    await info.attach('owner-obligation-proof', {
      contentType: 'application/json',
      body: JSON.stringify({
        qualifiedHistorical: true,
        immutableOfferPreserved: true,
        staleAdjustmentRejected: true,
        durationAttestedOnce: true,
        datedObservationIsSyntheticFixture: true
      })
    });
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      await stack.stop();
    }
  }
});
