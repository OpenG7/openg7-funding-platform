import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import type {
  AdminPublicationDraftsResponse,
  AdminSponsorshipsResponse,
  PublicationWorkshopState,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { acceptanceComposeArgs } from './acceptance-database.js';
import { adminSessionHeaders } from './admin-auth.js';
import { approveAcceptanceMedia } from './acceptance-media-review.js';
import { completeModeration } from './moderation.js';
import {
  openDeclaredSponsorshipTracking,
  openSponsorshipModeration,
  openSponsorshipWebsiteSettings
} from './sponsorship-dossier.js';
import { expect, test } from './test.js';

/** Read the actual remote mission through its signed service identity, without exporting a token. */
async function remoteMissionEvidence(missionId: string) {
  if (
    process.env.OPENG7_PREFLIGHT_ACCEPTANCE !== '1' ||
    !/^[a-f0-9-]{36}$/i.test(missionId)
  )
    throw new Error('The dedicated disposable Preflight recipe is required.');
  const { stdout } = await promisify(execFile)(
    'docker',
    [
      ...acceptanceComposeArgs(),
      'exec',
      '-T',
      'api',
      'node',
      '--input-type=module',
      '-e',
      `
    if(process.env.PREFLIGHT_URL!=='http://127.0.0.1:3400' || process.env.PREFLIGHT_TOKEN_URL!=='http://127.0.0.1:3401/token') throw new Error('Isolated Preflight endpoints required.');
    const tokenResponse=await fetch(process.env.PREFLIGHT_TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.PREFLIGHT_CLIENT_ID,client_secret:process.env.PREFLIGHT_CLIENT_SECRET})});
    if(!tokenResponse.ok) throw new Error('Local OAuth token rejected.');
    const token=await tokenResponse.json();
    const response=await fetch(process.env.PREFLIGHT_URL+'/api/missions/'+process.argv[1],{headers:{authorization:'Bearer '+token.access_token}});
    if(!response.ok) throw new Error('Remote mission read failed.');
    const detail=await response.json();
    process.stdout.write(JSON.stringify({missionId:detail.mission.id,status:detail.mission.status,source:detail.mission.source,tasks:detail.tasks.map(t=>({kind:t.kind,status:t.status,attempts:t.attempts})),results:detail.results.map(r=>({id:r.id,kind:r.kind,obsolete:r.obsolete,provenance:r.provenance})),proposalIds:detail.proposals.map(p=>p.id)}));
  `,
      missionId
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }
  );
  return JSON.parse(stdout) as {
    missionId: string;
    status: string;
    source: { version: number };
    tasks: { status: string }[];
    results: {
      kind: string;
      provenance: { provider: string; simulated: boolean };
    }[];
    proposalIds: string[];
  };
}

export async function prepareAndAdoptAcceptancePreflight(
  page: Page,
  request: APIRequestContext,
  contributionId: string,
  info: TestInfo
) {
  const get = async <T>(url: string): Promise<T> => {
    const response = await request.get(url, {
      headers: await adminSessionHeaders(request)
    });
    expect(response.ok(), url).toBe(true);
    return response.json() as Promise<T>;
  };
  const read = () =>
    get<PublicationWorkshopState>(
      '/api/admin/sponsorships/publication-workshop?contributionId=' +
        contributionId
    );
  let proposal: NonNullable<PublicationWorkshopState['proposal']>;
  let adoptedDrafts: {
    id: string;
    obligationId: string | null;
    channel: string;
  }[] = [];
  const reviewBeforeAdoption =
    await test.step('Funding source supplies its public presentation and the administrator reviews the dossier', async () => {
      await page.goto(
        '/admin/fundraiser/sponsors?sponsorshipId=' +
          contributionId +
          '&tab=publication'
      );
      await openSponsorshipWebsiteSettings(page);
      await page
        .getByLabel(/Slug public/i)
        .fill('recette-preflight-' + contributionId);
      await openDeclaredSponsorshipTracking(page);
      await page.getByLabel(/Destination feed/i).selectOption('openg7');
      await page
        .getByRole('combobox', { name: 'Statut de suivi déclaré', exact: true })
        .selectOption('planned');
      await page
        .getByLabel(/Resume public/i)
        .fill(
          'Organisation synthétique soutenant le développement de l’écosystème OpenG7.'
        );
      await page.locator('[data-og7="publication-tracking-save"]').click();
      await expect(
        page.getByText('Paramètres de suivi enregistrés', { exact: true })
      ).toBeVisible();
      const media = await get<SponsorshipMediaResponse>(
        '/api/admin/sponsorships/media?contributionId=' + contributionId
      );
      await approveAcceptanceMedia(
        page,
        request,
        contributionId,
        media.assets
          .filter((a) => a.reviewStatus !== 'approved')
          .map((a) => a.id)
      );
      await page
        .locator('[data-og7="dossier-tabs"]')
        .getByRole('button', { name: 'Publication', exact: true })
        .click();
      await page.locator('[data-og7="sponsorship-approve"]').click();
      await completeModeration(page);
      await expect
        .poll(async () => {
          const records = await get<AdminSponsorshipsResponse>(
            '/api/admin/sponsorships?search=' +
              encodeURIComponent(contributionId)
          );
          return records.items.find((r) => r.id === contributionId)
            ?.sponsor_review_status;
        })
        .toBe('approved');
      expect(
        JSON.stringify(
          await (await request.get('/api/public/sponsorships')).json()
        )
      ).not.toContain(contributionId);
      return { sourceReview: 'approved', websiteStillPrivate: true };
    });
  const remote =
    await test.step('Real Funding relay, OAuth/JWKS and Preflight worker return three current variants', async () => {
      await page.goto(
        '/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=' +
          contributionId +
          '&publicationReturn=' +
          contributionId
      );
      const workshop = page.locator('[data-og7="publication-workshop"]');
      await expect(workshop).toBeVisible();
      await expect
        .poll(
          async () => {
            const state = await read();
            return state.proposal?.editorialPreparation.state;
          },
          { timeout: 90000, intervals: [250, 1000, 2000] }
        )
        .toBe('ready_for_review');
      await workshop.locator('[data-og7="workshop-refresh"]').click();
      await expect(
        workshop.locator('[data-og7="workshop-prepare"]')
      ).toBeEnabled({ timeout: 20000 });
      const prepared = page.waitForResponse(
        (r) =>
          r.url().endsWith('/publication-workshop/prepare') &&
          r.request().method() === 'POST'
      );
      await workshop.locator('[data-og7="workshop-prepare"]').click();
      const response = await prepared;
      expect(response.ok(), await response.text()).toBe(true);
      const submitted = (await response.json()) as PublicationWorkshopState;
      expect(submitted.enabled).toBe(true);
      expect(submitted.mission?.id).toBeTruthy();
      let current: PublicationWorkshopState = submitted;
      await expect
        .poll(
          async () => {
            current = await read();
            return (
              current.proposal?.missionId === submitted.mission!.id &&
              current.proposal.editorialPreparation.state ===
                'ready_for_review' &&
              current.canAdopt
            );
          },
          { timeout: 90000, intervals: [250, 1000, 2000] }
        )
        .toBe(true);
      proposal = current.proposal!;
      expect(proposal.sourceVersion).toBe(submitted.sourceVersion);
      await workshop.locator('[data-og7="workshop-refresh"]').click();
      await expect(
        workshop.locator('[data-og7="workshop-adopt"]')
      ).toBeVisible();
      expect(proposal.provenance).toMatchObject({
        provider: 'mock',
        simulated: true
      });
      expect(proposal.editorialPreparation.publicationAuthorized).toBe(false);
      expect(
        proposal.editorialPreparation.variants.map((v) => v.destination).sort()
      ).toEqual(['facebook', 'linkedin', 'website']);
      const observed = await remoteMissionEvidence(proposal.missionId);
      expect(observed.missionId).toBe(proposal.missionId);
      expect(observed.status).toBe('review_ready');
      expect(observed.tasks).toHaveLength(5);
      expect(observed.tasks.every((t) => t.status === 'completed')).toBe(true);
      expect(
        observed.results.find((r) => r.kind === 'draft')?.provenance
      ).toMatchObject({ provider: 'mock', simulated: true });
      expect(observed.proposalIds).toContain(proposal.id);
      await workshop.locator('[data-og7="workshop-preview"]').click();
      await expect(
        workshop.locator('[data-og7="workshop-variant"]')
      ).toHaveCount(3);
      await workshop.screenshot({
        path: info.outputPath('preflight-three-current-variants.png')
      });
      return observed;
    });
  await test.step('A person explicitly adopts the remote proposal into private Funding owners', async () => {
    const workshop = page.locator('[data-og7="publication-workshop"]');
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith('/publication-workshop/adopt') &&
        r.request().method() === 'POST'
    );
    await workshop.locator('[data-og7="workshop-adopt"]').click();
    await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
    await page.locator('[data-og7="confirm-action"]').click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBe(true);
    const drafts = (
      await get<AdminPublicationDraftsResponse>('/api/admin/publication-drafts')
    ).drafts.filter((d) => d.contribution_id === contributionId);
    expect(drafts).toHaveLength(2);
    adoptedDrafts = drafts.map((draft) => ({
      id: draft.id,
      obligationId: draft.obligation_id ?? null,
      channel: draft.channel
    }));
    for (const draft of drafts) {
      const variant = proposal.editorialPreparation.variants.find(
        (v) => v.obligationId === draft.obligation_id
      )!;
      expect(draft.channel).toBe(variant.destination);
      expect(draft.body).toBe(variant.body);
      expect(draft.status).toBe('draft');
      expect(draft.approved_at).toBeNull();
      expect(draft.published_at).toBeNull();
    }
    await workshop.screenshot({
      path: info.outputPath('preflight-adoption-confirmed.png')
    });
  });
  const evidence = {
    transport:
      'real Funding relay, signed local OAuth/JWKS, real Preflight API and durable worker',
    ia: 'mock',
    reviewBeforeAdoption,
    remote,
    proposalId: proposal!.id,
    missionId: proposal!.missionId,
    sourceVersion: proposal!.sourceVersion,
    sourceSnapshotDigest: proposal!.editorialPreparation.sourceSnapshotDigest,
    variants: proposal!.editorialPreparation.variants.map((v) => ({
      destination: v.destination,
      obligationId: v.obligationId,
      obligationVersion: v.obligationVersion,
      body: v.body
    })),
    websiteSummary: proposal!.editorialPreparation.variants.find(
      (v) => v.destination === 'website'
    )!.summary
  };
  await info.attach('preflight-chain-evidence', {
    body: JSON.stringify({ ...evidence, adoptedDrafts }, null, 2),
    contentType: 'application/json'
  });
  await test.step('The administrator reviews the changed source content after adoption, separately from adopting it', async () => {
    await page.goto(
      '/admin/fundraiser/sponsors?sponsorshipId=' +
        contributionId +
        '&tab=publication'
    );
    const moderation = await openSponsorshipModeration(page);
    await moderation.getByRole('combobox').first().selectOption('N0');
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/moderation/decisions') &&
        r.request().method() === 'POST'
    );
    await moderation.locator('[data-og7="moderation-open"]').click();
    await completeModeration(page);
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBe(true);
    expect((await response.json()).decision).toMatchObject({
      subject: { type: 'sponsorship', id: contributionId },
      level: 'N0',
      state: 'active'
    });
  });
  return { ...evidence, adoptedDrafts };
}

/** Observe the source's real remaining obligations after its separate Web decision. */
export async function observeAcceptancePreflightRemainder(
  request: APIRequestContext,
  contributionId: string,
  adopted: { missionId: string; sourceVersion: number; proposalId: string },
  info: TestInfo
) {
  let current: PublicationWorkshopState;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          '/api/admin/sponsorships/publication-workshop?contributionId=' +
            contributionId,
          { headers: await adminSessionHeaders(request) }
        );
        expect(response.ok()).toBe(true);
        current = (await response.json()) as PublicationWorkshopState;
        const proposal = current.proposal;
        return (
          proposal !== null &&
          proposal.sourceVersion > adopted.sourceVersion &&
          proposal.editorialPreparation.variants
            .map((v) => v.destination)
            .sort()
            .join(',') === 'facebook,linkedin'
        );
      },
      { timeout: 90000, intervals: [250, 1000, 2000] }
    )
    .toBe(true);
  expect(
    current!.history.find((p) => p.id === adopted.proposalId)?.obsolete
  ).toBe(true);
  const old = await remoteMissionEvidence(adopted.missionId);
  expect(old.status).toBe('superseded');
  const evidence = {
    missionId: current!.mission!.id,
    sourceVersion: current!.sourceVersion,
    remainingDestinations: current!.proposal!.editorialPreparation.variants.map(
      (v) => v.destination
    ),
    oldMissionId: old.missionId,
    oldMissionStatus: old.status,
    sourceDecisionTransport: 'not connected; no global completion asserted'
  };
  await info.attach('preflight-reconciliation-evidence', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json'
  });
  return evidence;
}
