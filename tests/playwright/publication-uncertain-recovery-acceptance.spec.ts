import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';
import type {
  AdminAuditLogResponse,
  AdminSponsorshipRecord,
  AdminSponsorshipsResponse,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeedId,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const automation = '/api/admin/publication-automation';
const cockpit = '/admin/fundraiser/publications/automation';
const feeds: PublicationFeedId[] = ['openg7:facebook', 'openg7:linkedin'];
type Scenario = 'found' | 'absent' | 'control';
interface Company {
  scenario: Scenario;
  name: string;
  record: AdminSponsorshipRecord;
  jobs: PublicationDelivery[];
}
interface Receipt {
  requests: {
    deliveryId: string;
    accepted: boolean;
    postId: string | null;
    outcome: string;
    receivedAt: string;
  }[];
  posts: {
    id: string;
    deliveryId: string;
    message: string;
    accountId: string;
    feedId: string;
  }[];
}

test('lost social responses survive restart and recover through verified reconciliation or a fresh approval without duplicates', async ({
  page,
  context,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(480000);
  context.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const social = stub + '/__test__/social';
  const get = async <T>(url: string, authenticated = true): Promise<T> => {
    const response = await request.get(url, authenticated ? { headers } : {});
    expect(response.ok(), url).toBe(true);
    return response.json() as Promise<T>;
  };
  const command = async (data: PublicationAutomationCommand) => {
    const response = await request.post(automation, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const state = () => get<PublicationAutomationState>(automation);
  const delivery = async (id: string) => {
    const job = (await state()).deliveries.find((j) => j.id === id);
    expect(job).toBeTruthy();
    return job!;
  };
  const receipt = (id: string) =>
    get<Receipt>(social + '/receipts?deliveryId=' + id, false);
  const initial = await state();
  expect(initial.feeds.every((f) => f.mode === 'mock')).toBe(true);
  const companies: Company[] = [];
  const setWorker = async (enabled: boolean) => {
    const current = await state();
    if (current.workerEnabled !== enabled)
      await command({
        action: 'worker',
        enabled,
        version: current.workerVersion,
        confirmation: enabled ? 'enable-worker' : 'disable-worker'
      });
  };
  const openDelivery = async (id: string) => {
    await page.goto(cockpit + '?deliveryId=' + id);
    const dialog = page.getByRole('dialog', { name: 'Publication finale' });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  const approve = async (
    job: PublicationDelivery,
    date: Date,
    message: string
  ) => {
    const dialog = await openDelivery(job.id);
    await dialog.getByRole('button', { name: 'Modifier', exact: true }).click();
    await dialog.getByLabel('Texte exact à publier').fill(message);
    const local = await page.evaluate((iso) => {
      const d = new Date(iso);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }, date.toISOString());
    await dialog.locator('input[name="date"]').fill(local);
    const saved = page.waitForResponse(
      (r) => r.url().endsWith(automation) && r.request().method() === 'POST'
    );
    await dialog
      .getByRole('button', { name: 'Enregistrer le brouillon' })
      .click();
    expect((await saved).ok()).toBe(true);
    await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
    await dialog
      .getByRole('button', { name: 'Accepter et programmer' })
      .click();
    await expect(dialog).toContainText('Autorisée');
    Object.assign(job, await delivery(job.id));
    expect(job.status).toBe('approved');
  };
  const nextMinute = () =>
    new Date(Math.ceil((Date.now() + 60000) / 60000) * 60000);
  const buffer = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#28556e' }
  })
    .png()
    .toBuffer();
  try {
    await setWorker(false);
    for (const id of feeds) {
      await command({
        action: 'settings',
        settings: {
          id,
          paused: true,
          autoPrepare: false,
          timezone: 'UTC',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          localTime: '08:19',
          capacity: 1,
          horizonDays: 28
        }
      });
      await command({ action: 'check', feedId: id });
    }
    await test.step('Three companies pay 500 CAD, complete their dossiers and submit presentation media', async () => {
      for (const scenario of ['found', 'absent', 'control'] as const) {
        const name = `Atelier reprise ${scenario} ${randomUUID().slice(0, 8)}`;
        await page.goto('/fonds-des-batisseurs?intent=sponsorship#support');
        const form = page.locator('[data-og7="contribution-form"]');
        await form
          .getByRole('button', { name: /Commandite d'entreprise/ })
          .click();
        await form.getByRole('button', { name: '500 $', exact: true }).click();
        await form.getByRole('checkbox').nth(0).check();
        await form.locator('#public-display-name').fill(name);
        await form.getByRole('checkbox').nth(1).uncheck();
        await form.getByRole('checkbox').nth(2).check();
        await form.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(/\/checkout\/cs_test_/);
        const sessionId = new URL(page.url()).pathname.split('/').at(-1)!;
        const session = await get<{ client_reference_id: string }>(
          stub + '/v1/checkout/sessions/' + sessionId,
          false
        );
        await page
          .getByRole('button', { name: 'Confirmer le paiement simulé' })
          .click();
        await expect(page.locator('#followup-companyName')).toBeVisible();
        await page.locator('#followup-companyName').fill(name);
        await page.locator('#followup-contactName').fill('Contact de recette');
        await page
          .locator('#followup-contactEmail')
          .fill('contact@simulation.example.test');
        await page
          .locator('#followup-websiteUrl')
          .fill('https://simulation.example.test');
        for (const [label, filename] of [
          ['Ajouter le logo', 'logo.png'],
          ['Ajouter des photos', 'photo.png']
        ]) {
          await page
            .getByLabel('Description des images à téléverser')
            .fill('Présentation synthétique de ' + name);
          const upload = page.waitForResponse(
            (r) =>
              r.url().includes('/sponsorship-followup/media') &&
              r.request().method() === 'POST'
          );
          await page
            .getByLabel(label!)
            .setInputFiles({ name: filename!, mimeType: 'image/png', buffer });
          expect((await upload).ok()).toBe(true);
          await expect(
            page.locator('[data-og7="media-upload-attempt"]')
          ).toHaveCount(0);
        }
        await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(
          2
        );
        await page
          .getByRole('button', {
            name: 'Soumettre mes informations à l’équipe'
          })
          .click();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: /Informations enregistrées/ })
        ).toBeVisible();
        const sponsors = await get<AdminSponsorshipsResponse>(
          '/api/admin/sponsorships?search=' + session.client_reference_id
        );
        expect(sponsors.items).toHaveLength(1);
        expect(sponsors.items[0]).toMatchObject({
          payment_status: 'paid',
          sponsor_review_status: 'pending_review'
        });
        companies.push({
          scenario,
          name,
          record: sponsors.items[0]!,
          jobs: []
        });
      }
    });
    await signInAsAdmin(page);
    const due = nextMinute();
    const controlDue = new Date(due.getTime() + 60000);
    await test.step('Review media and explicitly schedule six text publications; configure one-shot lost responses', async () => {
      for (const company of companies) {
        await page.goto(
          '/admin/fundraiser/sponsors?sponsorshipId=' +
            company.record.id +
            '&tab=media'
        );
        await page
          .getByRole('button', { name: 'Tout approuver', exact: true })
          .click();
        await expect
          .poll(async () =>
            (
              await get<SponsorshipMediaResponse>(
                '/api/admin/sponsorships/media?contributionId=' +
                  company.record.id
              )
            ).assets.every((a) => a.reviewStatus === 'approved')
          )
          .toBe(true);
      }
      for (const feedId of feeds) await command({ action: 'prepare', feedId });
      for (const company of companies) {
        company.jobs = (await state()).deliveries.filter((j) =>
          j.sponsors.some((s) => s.id === company.record.id)
        );
        expect(company.jobs.map((j) => j.feedId).sort()).toEqual(feeds);
        for (const job of company.jobs) {
          expect(job.sponsors).toHaveLength(1);
          await approve(
            job,
            company.scenario === 'control' ? controlDue : due,
            `Merci à ${company.name}. Commandite rémunérée, recette simulée.`
          );
          if (company.scenario !== 'control') {
            const fault = await request.post(social + '/faults', {
              data: {
                deliveryId: job.id,
                fault:
                  company.scenario === 'found'
                    ? 'accepted-response-lost'
                    : 'absent-response-lost'
              }
            });
            expect(fault.ok()).toBe(true);
          }
          expect(await receipt(job.id)).toEqual({ requests: [], posts: [] });
        }
      }
      expect(Date.now()).toBeLessThan(due.getTime());
      for (const id of feeds) {
        const feed = (await state()).feeds.find((f) => f.id === id)!;
        await command({
          action: 'settings',
          settings: { ...feed, paused: false }
        });
      }
      await page.goto(cockpit);
      await page.locator('[data-og7="publication-worker-toggle"]').click();
      await page.locator('[data-og7="confirm-action"]').click();
      await expect(
        page.locator('[data-og7="publication-worker-toggle"]')
      ).toHaveAttribute('aria-checked', 'true');
    });
    const uncertain = companies.filter((c) => c.scenario !== 'control');
    const control = companies.find((c) => c.scenario === 'control')!;
    const versions = new Map<string, number>();
    await test.step('Lost responses quarantine all four jobs while the receiver retains the true outcomes', async () => {
      await expect
        .poll(
          async () => {
            const current = await state();
            return uncertain
              .flatMap((c) => c.jobs)
              .every(
                (j) =>
                  current.deliveries.find((d) => d.id === j.id)?.status ===
                  'uncertain'
              );
          },
          { timeout: 150000, intervals: [1000, 3000] }
        )
        .toBe(true);
      for (const company of uncertain)
        for (const job of company.jobs) {
          const current = await delivery(job.id);
          expect(current).toMatchObject({
            status: 'uncertain',
            attempts: 1,
            nextAttemptAt: null,
            publishedAt: null,
            externalPostId: null,
            errorCode: 'PROVIDER_UNREACHABLE'
          });
          versions.set(job.id, current.version);
          for (const action of ['approve', 'cancel'] as const) {
            const response = await request.post(automation, {
              headers,
              data: {
                action,
                id: job.id,
                version: current.version,
                confirmation: job.id
              }
            });
            expect(response.status()).toBe(409);
            expect(await response.json()).toMatchObject({
              code:
                action === 'approve'
                  ? 'APPROVAL_UNAVAILABLE'
                  : 'DELIVERY_LOCKED'
            });
          }
          const remote = await receipt(job.id);
          expect(remote.requests).toHaveLength(1);
          expect(remote.posts).toHaveLength(
            company.scenario === 'found' ? 1 : 0
          );
          const dialog = await openDelivery(job.id);
          await expect(dialog).toContainText('Aucune relance automatique');
          await expect(
            dialog.getByRole('button', {
              name: /Accepter et programmer|Annuler cet envoi|Modifier/
            })
          ).toHaveCount(0);
          await dialog.screenshot({
            path: info.outputPath(
              company.scenario +
                '-' +
                job.feedId.split(':')[1] +
                '-uncertain.png'
            )
          });
        }
    });
    await test.step('Restart only the disposable API; working controls prove the resumed worker never retries uncertain jobs', async () => {
      const project = process.env.COMPOSE_PROJECT_NAME!;
      expect(project).toMatch(/^og7-acceptance-[a-f0-9-]+$/);
      expect(process.env.COMPOSE_FILE).toBe(
        resolve('docker-compose.acceptance.yml')
      );
      await promisify(execFile)(
        'docker',
        ['compose', '--project-name', project, 'restart', 'api'],
        { windowsHide: true, timeout: 60000 }
      );
      await expect
        .poll(
          async () => {
            try {
              return (await request.get(automation, { headers })).status();
            } catch {
              return 0;
            }
          },
          { timeout: 45000, intervals: [1000] }
        )
        .toBe(200);
      expect((await state()).workerEnabled).toBe(true);
      await expect
        .poll(
          async () => {
            const current = await state();
            return control.jobs.every(
              (j) =>
                current.deliveries.find((d) => d.id === j.id)?.status ===
                'published'
            );
          },
          { timeout: 100000, intervals: [1000, 3000] }
        )
        .toBe(true);
      for (const job of control.jobs) {
        expect(await delivery(job.id)).toMatchObject({
          status: 'published',
          attempts: 1
        });
        expect((await receipt(job.id)).posts).toHaveLength(1);
        expect((await receipt(job.id)).requests).toHaveLength(1);
      }
      for (const company of uncertain)
        for (const job of company.jobs) {
          expect(await delivery(job.id)).toMatchObject({
            status: 'uncertain',
            version: versions.get(job.id),
            attempts: 1,
            publishedAt: null
          });
          expect((await receipt(job.id)).requests).toHaveLength(1);
        }
    });
    await test.step('Inspect the simulated provider and reconcile existing posts without another send', async () => {
      const found = companies.find((c) => c.scenario === 'found')!;
      for (const job of found.jobs) {
        await page.goto(social + '/inspect?deliveryId=' + job.id);
        await expect(
          page.getByRole('heading', {
            name: 'Réseau social simulé',
            exact: true
          })
        ).toBeVisible();
        await expect(page.locator('article')).toHaveCount(1);
        const externalId = await page.locator('article code').innerText();
        await expect(page.locator('article')).toContainText(job.message);
        const reconcile: PublicationAutomationCommand = {
          action: 'reconcile',
          id: job.id,
          version: versions.get(job.id)!,
          confirmation: job.id,
          externalPostId: externalId
        };
        expect(
          (await request.post(automation, { data: reconcile })).status()
        ).toBe(401);
        const invalidConfirmation = await request.post(automation, {
          headers,
          data: { ...reconcile, confirmation: '' }
        });
        expect(invalidConfirmation.status()).toBe(400);
        const dialog = await openDelivery(job.id);
        const wrongId = (
          await receipt(control.jobs.find((c) => c.feedId === job.feedId)!.id)
        ).posts[0]!.id;
        await dialog
          .getByLabel(
            'Identifiant de la publication déjà visible sur le réseau'
          )
          .fill(wrongId);
        await dialog
          .getByRole('button', { name: 'Vérifier et confirmer la publication' })
          .click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        expect((await delivery(job.id)).status).toBe('uncertain');
        await dialog
          .getByLabel(
            'Identifiant de la publication déjà visible sur le réseau'
          )
          .fill(externalId);
        await dialog
          .getByRole('button', { name: 'Vérifier et confirmer la publication' })
          .click();
        await expect(
          dialog.getByRole('link', { name: 'Voir la publication' })
        ).toBeVisible();
        expect(await delivery(job.id)).toMatchObject({
          status: 'published',
          attempts: 1,
          externalPostId: externalId
        });
        expect((await receipt(job.id)).requests).toHaveLength(1);
        const replay = await request.post(automation, {
          headers,
          data: reconcile
        });
        expect(replay.status()).toBe(409);
        expect(await replay.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
        await page.reload();
        await expect(
          page
            .getByRole('dialog', { name: 'Publication finale' })
            .getByRole('link', { name: 'Voir la publication' })
        ).toBeVisible();
      }
    });
    const absent = companies.find((c) => c.scenario === 'absent')!;
    await test.step('Confirm absence with an explicit audit reason, then require new draft approval', async () => {
      const retryDue = nextMinute();
      for (const job of absent.jobs) {
        await page.goto(social + '/inspect?deliveryId=' + job.id);
        await expect(
          page.getByText('Aucune publication trouvée pour cet envoi.', {
            exact: true
          })
        ).toBeVisible();
        await expect(page.locator('article')).toHaveCount(0);
        const dialog = await openDelivery(job.id);
        // An invented identifier cannot turn an absent provider post into a success.
        await dialog
          .getByLabel(
            'Identifiant de la publication déjà visible sur le réseau'
          )
          .fill('mock-' + job.id);
        const lookup = page.waitForResponse(
          (r) => r.url().endsWith(automation) && r.request().method() === 'POST'
        );
        await dialog
          .getByRole('button', { name: 'Vérifier et confirmer la publication' })
          .click();
        const lookupResult = await lookup;
        expect(lookupResult.status()).toBe(503);
        expect(await lookupResult.json()).toMatchObject({
          code: 'REMOTE_POST_UNVERIFIED'
        });
        await expect(dialog.getByRole('alert')).toContainText(
          'avant de conclure à son absence'
        );
        await dialog.screenshot({
          path: info.outputPath(job.feedId.split(':')[1] + '-unverified.png')
        });
        expect((await delivery(job.id)).status).toBe('uncertain');
        await dialog
          .getByText('Après vérification : la publication est absente', {
            exact: true
          })
          .click();
        const confirm = dialog.getByRole('button', {
          name: 'Consigner la vérification'
        });
        await expect(confirm).toBeDisabled();
        await dialog
          .getByLabel(
            'Vérification effectuée (20 caractères minimum, sans donnée privée)'
          )
          .fill(
            'Historique du fournisseur simulé inspecté : aucun contenu correspondant à cet envoi.'
          );
        await expect(confirm).toBeDisabled();
        await dialog
          .getByRole('checkbox', {
            name: 'J’ai vérifié que cet envoi n’a créé aucune publication.'
          })
          .check();
        await confirm.click();
        await expect(
          dialog.getByRole('button', { name: 'Modifier', exact: true })
        ).toBeVisible();
        expect(await delivery(job.id)).toMatchObject({
          status: 'blocked',
          approvedAt: null,
          errorCode: 'ABSENCE_CONFIRMED',
          attempts: 1
        });
        expect((await receipt(job.id)).requests).toHaveLength(1);
        const blocked = await delivery(job.id);
        const replay = await request.post(automation, {
          headers,
          data: {
            action: 'confirm-absent',
            id: job.id,
            version: versions.get(job.id),
            confirmation: job.id,
            reason:
              'Historique du fournisseur simulé inspecté : aucun contenu correspondant à cet envoi.'
          }
        });
        expect(replay.status()).toBe(409);
        expect(await replay.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
        const bypass = await request.post(automation, {
          headers,
          data: {
            action: 'approve',
            id: job.id,
            version: blocked.version,
            confirmation: job.id
          }
        });
        expect(bypass.status()).toBe(409);
        expect(await bypass.json()).toMatchObject({
          code: 'APPROVAL_UNAVAILABLE'
        });
        await approve(job, retryDue, job.message);
        expect((await receipt(job.id)).requests).toHaveLength(1);
      }
      expect(Date.now()).toBeLessThan(retryDue.getTime());
    });
    await test.step('The new approvals send once with the browser closed; receipts and audit prove no duplicates', async () => {
      await page.close();
      await expect
        .poll(
          async () => {
            const current = await state();
            return absent.jobs.every(
              (j) =>
                current.deliveries.find((d) => d.id === j.id)?.status ===
                'published'
            );
          },
          { timeout: 150000, intervals: [1000, 3000] }
        )
        .toBe(true);
      const audit = await get<AdminAuditLogResponse>('/api/admin/audit-log');
      const evidence: unknown[] = [];
      for (const company of companies)
        for (const job of company.jobs) {
          const current = await delivery(job.id);
          const remote = await receipt(job.id);
          const entries = audit.entries.filter((e) => e.entity_id === job.id);
          const attempts = company.scenario === 'absent' ? 2 : 1;
          expect(current).toMatchObject({
            status: 'published',
            attempts,
            mode: 'mock',
            externalPostId: 'mock-' + job.id
          });
          expect(remote.requests).toHaveLength(attempts);
          expect(remote.posts).toHaveLength(1);
          expect(remote.requests.filter((r) => r.accepted)).toHaveLength(1);
          expect(
            entries.filter(
              (e) => e.action === 'publication_automation.published'
            )
          ).toHaveLength(1);
          expect(
            entries.filter(
              (e) => e.action === 'publication_automation.uncertain'
            )
          ).toHaveLength(company.scenario === 'control' ? 0 : 1);
          expect(
            entries.filter(
              (e) => e.action === 'publication_automation.reconcile'
            )
          ).toHaveLength(company.scenario === 'found' ? 1 : 0);
          const reviews = entries.filter(
            (e) => e.action === 'publication_automation.absence_review'
          );
          expect(reviews).toHaveLength(company.scenario === 'absent' ? 1 : 0);
          if (reviews.length)
            expect(reviews[0]!.metadata).toMatchObject({
              reason: expect.stringContaining('fournisseur simulé inspecté')
            });
          evidence.push({
            scenario: company.scenario,
            delivery: current,
            provider: remote,
            audit: entries
          });
        }
      await info.attach('uncertain-publication-recovery-evidence', {
        body: JSON.stringify(
          {
            providers: 'simulated',
            apiRestarted: true,
            due,
            controlDue,
            evidence
          },
          null,
          2
        ),
        contentType: 'application/json'
      });
      expect(errors).toEqual([]);
    });
  } finally {
    await setWorker(false);
    for (const id of feeds) {
      const {
        paused,
        autoPrepare,
        timezone,
        weekdays,
        localTime,
        capacity,
        horizonDays
      } = initial.feeds.find((f) => f.id === id)!;
      await command({
        action: 'settings',
        settings: {
          id,
          paused,
          autoPrepare,
          timezone,
          weekdays,
          localTime,
          capacity,
          horizonDays
        }
      });
    }
    await setWorker(initial.workerEnabled);
  }
});
