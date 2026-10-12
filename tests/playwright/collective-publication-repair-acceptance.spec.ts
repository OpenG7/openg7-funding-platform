import { randomUUID } from 'node:crypto';

import type {
  AdminAuditLogResponse,
  AdminPublicationBatchMutationResult,
  AdminPublicationDraftMutationResult,
  AdminSponsorshipsResponse,
  PilotCommand,
  ProgrammeState,
  PublicationAutomationCommand,
  PublicationAutomationState
} from '@openg7/funding-core';

import { rejectAcceptanceSponsorship } from './support/acceptance-oidc-moderation.js';
import {
  approveAcceptanceFixture,
  approveAcceptanceSubject,
  acceptanceModerationDecision,
  completePublicationModeration
} from './support/acceptance-moderation.js';
import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin, adminSessionHeaders } from './support/admin-auth.js';
import { runAcceptancePublicationWorker } from './support/acceptance-publication-worker.js';
import { expect, test } from './support/test.js';

for (const cause of ['rejection', 'destination'] as const)
  test(
    cause === 'rejection'
      ? 'a rejected company blocks its approved collective post; reviewed recomposition and new approval publish only the retained company'
      : 'a changed company destination blocks its approved collective post; reviewed recomposition and new approval publish only the retained company',
    async ({ page, request, browser }, info) => {
      test.skip(
        process.env.OPENG7_E2E_ISOLATED !== '1',
        'Disposable simulation only.'
      );
      test.setTimeout(210000);
      page.setDefaultTimeout(15000);
      const headers = await adminSessionHeaders(request);
      const automation = '/api/admin/publication-automation';
      const feedId = 'openg7:facebook';
      const get = async <T>(url: string, auth = true): Promise<T> => {
        const r = await request.get(url, auth ? { headers } : {});
        expect(r.ok(), url).toBe(true);
        return r.json();
      };
      const post = async <T>(url: string, data: unknown): Promise<T> => {
        const r = await request.post(url, { headers, data });
        expect(r.ok(), await r.text()).toBe(true);
        return r.json();
      };
      const state = () => get<PublicationAutomationState>(automation);
      const command = (input: PublicationAutomationCommand) =>
        post(automation, input);
      const tick = (now: Date) =>
        expect
          .poll(() => runAcceptancePublicationWorker(now), {
            timeout: 15000,
            intervals: [100, 500, 1000]
          })
          .toBe(true);
      const programme = () =>
        get<ProgrammeState>('/api/admin/pilotage/programme');
      const worker = async (enabled: boolean) => {
        const current = await state();
        if (current.workerEnabled !== enabled)
          await command({
            action: 'worker',
            enabled,
            version: current.workerVersion,
            confirmation: enabled ? 'enable-worker' : 'disable-worker'
          });
      };
      const sponsor = async (reference: string) =>
        (
          await get<AdminSponsorshipsResponse>(
            '/api/admin/sponsorships?search=' + reference
          )
        ).items[0]!;
      const removedFixture =
        cause === 'rejection'
          ? SPONSORSHIP_FIXTURES.collectiveRemoved
          : SPONSORSHIP_FIXTURES.collectiveDestinationRemoved;
      const retainedFixture =
        cause === 'rejection'
          ? SPONSORSHIP_FIXTURES.collectiveRetained
          : SPONSORSHIP_FIXTURES.collectiveDestinationRetained;
      await approveAcceptanceFixture(request, removedFixture.publicReference);
      await approveAcceptanceFixture(request, retainedFixture.publicReference);
      const removed = await sponsor(removedFixture.publicReference);
      const retained = await sponsor(retainedFixture.publicReference);
      const initial = await state();
      const initialFeed = initial.feeds.find((f) => f.id === feedId)!;
      expect(initial.feeds.every((f) => f.mode === 'mock')).toBe(true);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let id = '';
      const delivery = async () =>
        (await state()).deliveries.find((d) => d.id === id)!;
      const receipts = () =>
        get<{ requests: unknown[]; posts: { message: string }[] }>(
          process.env.STRIPE_STUB_BASE_URL +
            '/__test__/social/receipts?deliveryId=' +
            id,
          false
        );
      const openDelivery = async () => {
        await page.goto(
          '/admin/fundraiser/publications/automation?deliveryId=' + id
        );
        const dialog = page.getByRole('dialog', { name: 'Publication finale' });
        await expect(dialog).toBeVisible();
        return dialog;
      };
      const approve = async () => {
        const dialog = await openDelivery();
        await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
        await dialog
          .getByRole('button', { name: 'Accepter et programmer' })
          .click();
        await completePublicationModeration(page);
        await expect(dialog).toContainText('Autorisée');
      };
      try {
        await worker(false);
        for (const feed of initial.feeds.filter((f) => f.id !== feedId)) {
          await command({
            action: 'settings',
            settings: { ...feed, autoPrepare: false }
          });
        }
        await command({
          action: 'settings',
          settings: {
            ...initialFeed,
            paused: true,
            autoPrepare: false,
            capacity: 2
          }
        });
        await command({ action: 'check', feedId });
        const batch = (
          await post<AdminPublicationBatchMutationResult>(
            '/api/admin/publication-batches',
            {
              channel: 'facebook',
              capacity: 2,
              notes: 'Collective repair simulation'
            }
          )
        ).batch!;
        const draftSources = new Map<string, { id: string; title: string }>();
        for (const s of [removed, retained]) {
          const draft = (
            await post<AdminPublicationDraftMutationResult>(
              '/api/admin/publication-drafts',
              {
                contributionId: s.id,
                feedTarget: 'openg7',
                channel: 'facebook'
              }
            )
          ).draft!;
          draftSources.set(s.id, draft);
          await post('/api/admin/publication-drafts/update', {
            draftId: draft.id,
            status: 'approved',
            confirmation: draft.id,
            moderationDecision: await acceptanceModerationDecision(request, {
              type: 'publication_draft',
              id: draft.id
            })
          });
          await post('/api/admin/publication-batches/assign', {
            batchId: batch.id,
            draftId: draft.id
          });
          await approveAcceptanceSubject(request, {
            type: 'publication_draft',
            id: draft.id
          });
        }
        const retainedDraft = draftSources.get(retained.id);
        if (!retainedDraft)
          throw new Error('Retained publication draft is missing.');
        await post('/api/admin/publication-batches/schedule', {
          batchId: batch.id,
          scheduledAt: new Date(Date.now() + 86400000).toISOString()
        });
        id = (
          await post<{ id: string }>(automation, {
            action: 'compose',
            feedId,
            kind: 'sponsorship',
            batchId: batch.id
          })
        ).id;
        expect((await delivery()).sponsors.map((s) => s.id).sort()).toEqual(
          [removed.id, retained.id].sort()
        );
        await signInAsAdmin(page);
        await approve();
        const approved = await delivery();
        await test.step(
          cause === 'rejection'
            ? 'Reject one company through two identified people before the due date'
            : 'Change one company destination while the approved publication remains in the future',
          async () => {
            if (cause === 'rejection') {
              await rejectAcceptanceSponsorship(
                browser,
                removedFixture.publicReference,
                'Entreprise retirée du lot de recette. Aucun remboursement demandé.'
              );
              await expect
                .poll(
                  async () =>
                    (await sponsor(removedFixture.publicReference))
                      .sponsor_review_status
                )
                .toBe('rejected');
            } else {
              await page.goto(
                '/admin/fundraiser/sponsors?sponsorshipId=' +
                  removed.id +
                  '&tab=publication'
              );
              await page
                .locator('[data-og7="publication-advanced"] > summary')
                .click();
              const editor = page.locator(
                '[data-og7="dossier-publication-editor"]'
              );
              // The editor suggests a slug; preserve reviewed content while rerouting.
              await editor
                .getByLabel(/Slug public/i)
                .fill(removed.sponsor_public_slug ?? '');
              await editor
                .getByLabel(/Destination feed/i)
                .selectOption('openg20');
              const saved = page.waitForResponse(
                (response) =>
                  response
                    .url()
                    .endsWith('/api/admin/sponsorships/publication') &&
                  response.request().method() === 'POST'
              );
              await editor
                .getByRole('button', { name: 'Enregistrer', exact: true })
                .click();
              const response = await saved;
              expect(response.ok(), await response.text()).toBe(true);
              expect(response.request().postDataJSON()).toMatchObject({
                contributionId: removed.id,
                feedTarget: 'openg20',
                confirmation: removed.id
              });
              expect(response.request().postDataJSON().publicSlug ?? null).toBe(
                removed.sponsor_public_slug
              );
              await expect
                .poll(() => sponsor(removedFixture.publicReference))
                .toMatchObject({
                  payment_status: 'paid',
                  sponsor_review_status: 'approved',
                  public_display_consent: true,
                  sponsor_public_slug: removed.sponsor_public_slug,
                  sponsor_feed_target: 'openg20',
                  amount: removed.amount
                });
            }
            const revoked = await delivery();
            if (cause === 'rejection') {
              // Pending N4 and independent confirmation each revoke dependent authority.
              expect(revoked).toMatchObject({
                status: 'blocked',
                version: approved.version + 2,
                approvedAt: null,
                publishedAt: null,
                attempts: 0,
                errorCode: 'MODERATION_RESTRICTED'
              });
            }
            const issue = (await programme()).issues.find(
              (i) => i.deliveryId === id
            )!;
            if (cause === 'destination')
              expect(issue.codes).toContain('DESTINATION_CHANGED');
            expect(issue.repair).not.toBeNull();
            const proposed = issue.repair!;
            expect(proposed.removed).toContain(removed.id);
            expect(proposed.sponsors.map((s) => s.id)).toEqual([retained.id]);
            await worker(true);
            const now = new Date();
            await expect
              .poll(
                async () => {
                  await runAcceptancePublicationWorker(now);
                  return (await delivery()).status;
                },
                { timeout: 15000, intervals: [100, 500, 1000] }
              )
              .toBe('blocked');
            await worker(false);
            if (cause === 'rejection')
              expect(await delivery()).toEqual(revoked);
            else
              expect(await delivery()).toMatchObject({
                status: 'blocked',
                version: approved.version + 1,
                attempts: 0,
                approvedAt: null,
                publishedAt: null
              });
            expect((await receipts()).requests).toHaveLength(0);
            const editedTitle = `${retainedDraft.title} — contenu conservé relu`;
            const editedSource =
              await post<AdminPublicationDraftMutationResult>(
                '/api/admin/publication-drafts/update',
                { draftId: retainedDraft.id, title: editedTitle }
              );
            expect(editedSource).toMatchObject({
              updated: true,
              draft: { id: retainedDraft.id, title: editedTitle }
            });
            await approveAcceptanceSubject(request, {
              type: 'publication_draft',
              id: retainedDraft.id
            });
            // The source edit also invalidates the delivery's editorial snapshot.
            // Review that current content before requesting private repair;
            // this N0 grants no new business authorization to send it.
            await approveAcceptanceSubject(request, {
              type: 'publication_delivery',
              id
            });
            expect(await delivery()).toMatchObject({
              status: 'blocked',
              approvedAt: null,
              attempts: 0,
              publishedAt: null
            });
            expect((await receipts()).requests).toHaveLength(0);
            const currentProposal = (await programme()).issues.find(
              (issue) => issue.deliveryId === id
            )!.repair!;
            expect(currentProposal.version).not.toBe(proposed.version);
            expect(currentProposal.message).toContain(editedTitle);
            expect(currentProposal.removed).toContain(removed.id);
            expect(currentProposal.sponsors.map((s) => s.id)).toEqual([
              retained.id
            ]);
            const beforeStaleCommand = await delivery();
            const stale = await post<{ code: string }>(
              '/api/admin/pilotage/command',
              {
                requestId: randomUUID(),
                action: 'publication.repair',
                targetId: id,
                confirmation: id,
                version: proposed.version
              }
            );
            expect(stale.code).toBe('VERSION_CONFLICT');
            expect(await delivery()).toEqual(beforeStaleCommand);
            expect((await receipts()).requests).toHaveLength(0);
          }
        );
        await test.step('Preview and cancel change nothing; confirmed recomposition creates a draft with no publishing authority', async () => {
          await page.goto('/admin/fundraiser/pilotage');
          await page.locator('[data-og7="open-programme"]').click();
          await page
            .getByRole('button', {
              name: 'Résoudre les incidents',
              exact: true
            })
            .click();
          const incident = page.locator(
            '[data-og7="programme-incident"][data-og7-id="' + id + '"]'
          );
          await expect(incident).toContainText(retainedFixture.companyName);
          const before = await delivery();
          await incident
            .getByRole('button', { name: 'Examiner cette recomposition' })
            .click();
          const confirmation = page.locator(
            '[data-og7="programme-confirmation"]'
          );
          await expect(confirmation).toContainText('nouvelle approbation');
          await confirmation
            .getByRole('button', {
              name: 'Revenir à la proposition',
              exact: true
            })
            .click();
          expect(await delivery()).toEqual(before);
          await incident
            .getByRole('button', { name: 'Examiner cette recomposition' })
            .click();
          const pending = page.waitForResponse(
            (r) =>
              r.url().endsWith('/api/admin/pilotage/command') &&
              r.request().method() === 'POST'
          );
          await confirmation
            .getByRole('button', { name: 'Confirmer l’enregistrement' })
            .click();
          const response = await pending;
          expect(response.ok()).toBe(true);
          expect(await response.json()).toMatchObject({ status: 'completed' });
          const input = response.request().postDataJSON() as PilotCommand;
          const auth = response.request().headers()['authorization'];
          const replay = await page.request.post(
            '/api/admin/pilotage/command',
            {
              headers: auth ? { Authorization: auth } : {},
              data: input
            }
          );
          expect((await replay.json()).status).toBe('completed');
          const repaired = await delivery();
          expect(repaired).toMatchObject({
            status: 'draft',
            approvedAt: null,
            attempts: 0,
            mediaId: null
          });
          expect(repaired.sponsors.map((s) => s.id)).toEqual([retained.id]);
          expect(repaired.message).toContain(retainedFixture.companyName);
          expect(repaired.message).not.toContain(removedFixture.companyName);
          expect((await receipts()).requests).toHaveLength(0);
          // Recomposition detaches and reassigns the source, invalidating its review again.
          await approveAcceptanceSubject(request, {
            type: 'publication_draft',
            id: retainedDraft.id
          });
          await page.screenshot({
            path: info.outputPath('collective-repair-confirmed.png'),
            fullPage: true
          });
        });
        await test.step('Review the exact recomposed content, authorize its new schedule and capture one provider post', async () => {
          const dialog = await openDelivery();
          await dialog
            .getByRole('button', { name: 'Modifier', exact: true })
            .click();
          const requestedDate = new Date(
            Math.ceil((Date.now() + 60000) / 60000) * 60000
          );
          const local = await page.evaluate((iso) => {
            const d = new Date(iso);
            return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
          }, requestedDate.toISOString());
          await dialog.locator('input[name="date"]').fill(local);
          await dialog
            .getByRole('button', { name: 'Enregistrer le brouillon' })
            .click();
          await expect(
            dialog.getByRole('checkbox', { name: /J’approuve/ })
          ).toBeVisible();
          await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
          await dialog
            .getByRole('button', { name: 'Accepter et programmer' })
            .click();
          await completePublicationModeration(page);
          await expect(dialog).toContainText('Autorisée');
          // The UI accepts minute precision. Drive the worker against the exact
          // approved date returned by the API, not an unpersisted browser value.
          const due = new Date((await delivery()).scheduledAt);
          await command({
            action: 'settings',
            settings: {
              ...initialFeed,
              paused: false,
              autoPrepare: false,
              capacity: 2
            }
          });
          await worker(true);
          await tick(new Date(due.getTime() - 1));
          expect(await delivery()).toMatchObject({
            status: 'approved',
            scheduledAt: due.toISOString(),
            attempts: 0,
            publishedAt: null
          });
          expect((await receipts()).requests).toHaveLength(0);
          expect((await receipts()).posts).toHaveLength(0);
          await expect
            .poll(
              async () => {
                await runAcceptancePublicationWorker(due);
                return (await delivery()).status;
              },
              { timeout: 15000, intervals: [100, 500, 1000] }
            )
            .toBe('published');
          const published = await delivery();
          await tick(due);
          expect(await delivery()).toEqual(published);
          await worker(false);
          const received = await receipts();
          expect(received.requests).toHaveLength(1);
          expect(received.posts).toHaveLength(1);
          expect(received.posts[0]!.message).toBe((await delivery()).message);
          expect(received.posts[0]!.message).not.toContain(
            removedFixture.companyName
          );
          expect(await sponsor(removedFixture.publicReference)).toMatchObject({
            payment_status: 'paid',
            sponsor_review_status:
              cause === 'rejection' ? 'rejected' : 'approved',
            ...(cause === 'destination'
              ? {
                  public_display_consent: true,
                  sponsor_feed_target: 'openg20',
                  sponsor_public_slug: removed.sponsor_public_slug
                }
              : {}),
            amount: removed.amount
          });
          const audits = (
            await get<AdminAuditLogResponse>('/api/admin/audit-log')
          ).entries.filter((e) => e.entity_id === id);
          expect(
            audits.filter(
              (e) => e.action === 'publication_automation.repair_proposed'
            )
          ).toHaveLength(1);
          expect(
            audits.filter((e) => e.action === 'publication_automation.approve')
          ).toHaveLength(2);
          expect(
            audits.filter(
              (e) => e.action === 'publication_automation.published'
            )
          ).toHaveLength(1);
          expect(
            audits.filter((e) => e.action === 'publication_automation.claim')
          ).toHaveLength(1);
          await info.attach('collective-repair-evidence', {
            contentType: 'application/json',
            body: JSON.stringify({
              providers: 'simulated',
              publicationWorkerClock: 'controlled at the approved schedule',
              delivery: await delivery(),
              receipts: received
            })
          });
          expect(errors).toEqual([]);
        });
      } finally {
        await worker(false);
        for (const feed of initial.feeds) {
          await command({ action: 'settings', settings: feed });
        }
        await worker(initial.workerEnabled);
      }
    }
  );
