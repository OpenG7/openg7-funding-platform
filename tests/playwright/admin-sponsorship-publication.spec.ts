import type {
  AdminPublicationDraftMutationResult,
  AdminSponsorshipProgressResponse,
  AdminSponsorshipsResponse,
  PublicSponsorshipsResponse,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import {
  adminSessionHeaders,
  openFixtureSponsorship,
  signInAsAdmin
} from './support/admin-auth.js';
import {
  approveCurrentModeration,
  completeModeration,
  currentModerationApproval
} from './support/moderation.js';

// Covers the admin feed-publication editor (OpenG7/OpenG20, Facebook/
// LinkedIn placement). No external network call is involved: the static
// coverage test (tests/funding-sponsorship-e2e-coverage.test.mjs) already
// asserts graph.facebook.com/api.linkedin.com never appear in the source --
// this is a purely internal form + DB round trip, verified here end to end
// through to the public /commanditaires directory.

test.describe('Docker admin sponsorship feed publication', () => {
  test('saves a feed placement and shows it on the public sponsors directory', async ({
    page,
    request
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.directory;
    const headers = await adminSessionHeaders(request);
    const seeded = await request.get(
      '/api/admin/sponsorships?search=' + fixture.publicReference,
      { headers }
    );
    expect(seeded.ok()).toBe(true);
    const records = (await seeded.json()) as AdminSponsorshipsResponse;
    expect(records.items).toHaveLength(1);
    const id = records.items[0]!.id;
    await approveCurrentModeration(request, { type: 'sponsorship', id });
    const mediaResponse = await request.get(
      '/api/admin/sponsorships/media?contributionId=' + id,
      { headers }
    );
    expect(mediaResponse.ok()).toBe(true);
    const presentation = (
      (await mediaResponse.json()) as SponsorshipMediaResponse
    ).assets.filter((asset) => asset.kind === 'supporting_image');
    expect(presentation).toHaveLength(1);
    expect(presentation[0]!.reviewStatus).toBe('approved');
    await approveCurrentModeration(request, {
      type: 'media',
      id: presentation[0]!.id
    });
    await signInAsAdmin(page);
    await openFixtureSponsorship(page, fixture.companyName);

    await page
      .getByRole('button', { name: 'Publication', exact: true })
      .click();

    await page.locator('[data-og7="publication-advanced"] > summary').click();
    const editor = page.locator('[data-og7="dossier-publication-editor"]');
    await expect(editor).toBeVisible();

    const slug = 'e2e-playwright-fixture-directory';
    const feedUrl = 'https://example.com/e2e-playwright-fixture-directory-feed';

    await editor.getByLabel(/Slug public/i).fill(slug);
    await editor.getByLabel(/Destination feed/i).selectOption('openg7');
    // Save edited content before asking for review of that exact revision.
    await editor.getByLabel(/Statut feed/i).selectOption('drafted');

    // Some tiers force a channel on (isPromisedFeedChannel), which disables
    // the checkbox -- only check the ones this fixture's tier leaves free.
    const facebookCheckbox = editor.getByLabel('Facebook');
    if (await facebookCheckbox.isEnabled()) {
      await facebookCheckbox.check();
    }
    const linkedinCheckbox = editor.getByLabel('LinkedIn');
    if (await linkedinCheckbox.isEnabled()) {
      await linkedinCheckbox.check();
    }

    await editor
      .getByLabel(/Resume public/i)
      .fill('E2E Playwright: resume public de test automatise.');
    await editor.getByLabel(/Lien de publication/i).fill(feedUrl);
    await editor
      .getByLabel(/Notes feed/i)
      .fill('E2E Playwright: note de feed automatisee.');

    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText('Publication enregistree')).toBeVisible();
    // Editing the public placement invalidates the prior editorial revision.
    const moderation = page.locator('[data-og7="moderation-actions"]');
    await moderation.getByRole('combobox').first().selectOption('N0');
    await moderation.locator('[data-og7="moderation-open"]').click();
    const reviewed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/moderation/decisions') &&
        response.request().method() === 'POST'
    );
    await completeModeration(page);
    const reviewResponse = await reviewed;
    expect(reviewResponse.ok(), await reviewResponse.text()).toBe(true);
    expect(await reviewResponse.json()).toMatchObject({
      decision: {
        subject: { type: 'sponsorship', id },
        level: 'N0',
        state: 'active'
      }
    });

    // Manual publication still requires reviewed source content per channel.
    for (const channel of ['facebook', 'linkedin'] as const) {
      const created = await request.post('/api/admin/publication-drafts', {
        headers,
        data: { contributionId: id, feedTarget: 'openg7', channel }
      });
      expect(created.ok(), await created.text()).toBe(true);
      const draft = (
        (await created.json()) as AdminPublicationDraftMutationResult
      ).draft!;
      expect(draft).toMatchObject({ contribution_id: id, channel });
      expect(draft.body).toContain(
        'E2E Playwright: resume public de test automatise.'
      );
      const approved = await request.post(
        '/api/admin/publication-drafts/update',
        {
          headers,
          data: {
            draftId: draft.id,
            status: 'approved',
            confirmation: draft.id,
            moderationDecision: await currentModerationApproval(request, {
              type: 'publication_draft',
              id: draft.id
            })
          }
        }
      );
      expect(approved.ok(), await approved.text()).toBe(true);
      expect(
        (await approved.json()) as AdminPublicationDraftMutationResult
      ).toMatchObject({
        updated: true,
        draft: { id: draft.id, status: 'approved' }
      });
    }

    await page.reload();
    await page
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await page.locator('[data-og7="publication-advanced"] > summary').click();
    await editor.getByLabel(/Statut feed/i).selectOption('published');
    const published = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/sponsorships/publication') &&
        response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('[data-og7="confirm-action"]').click();
    const publicationResponse = await published;
    expect(publicationResponse.ok(), await publicationResponse.text()).toBe(
      true
    );
    await expect(page.getByText('Publication enregistree')).toBeVisible();

    // Reload and reopen the same tab to confirm the save actually persisted
    // to the database rather than only updating local component state.
    await page.reload();
    await openFixtureSponsorship(page, fixture.companyName);
    await page
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await page.locator('[data-og7="publication-advanced"] > summary').click();
    await expect(
      page.locator('.publication-editor').getByLabel(/Slug public/i)
    ).toHaveValue(slug);

    // Social placement and website visibility remain separate persisted facts.
    const progressResponse = await request.get(
      '/api/admin/sponsorships/progress?sponsorshipId=' + id,
      { headers }
    );
    expect(progressResponse.ok()).toBe(true);
    const progress =
      (await progressResponse.json()) as AdminSponsorshipProgressResponse;
    expect(progress.dossier).toMatchObject({
      contributionId: id,
      website: { visible: true, held: false }
    });
    const publicResponse = await request.get('/api/public/sponsorships');
    expect(publicResponse.ok()).toBe(true);
    const profiles =
      (await publicResponse.json()) as PublicSponsorshipsResponse;
    expect(
      profiles.sponsorships.find((item) => item.public_slug === slug)
    ).toMatchObject({
      company_name: fixture.companyName,
      feed_status: 'published',
      feed_public_url: feedUrl
    });

    await page.goto('/commanditaires');
    const sponsorRow = page.locator('.sponsors-list li', {
      hasText: fixture.companyName
    });
    await expect(sponsorRow).toBeVisible();
    await expect(
      sponsorRow.getByRole('link', { name: /Voir la publication/ })
    ).toHaveAttribute('href', feedUrl);
  });
});
