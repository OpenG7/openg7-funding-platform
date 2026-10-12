import { createHash } from 'node:crypto';

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot,
  type SponsorshipOfferFormatOptions
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  fixture,
  json,
  mock,
  path,
  visit
} from './support/sponsorship-followup.js';

/** Synthetic server terms: use the public normalization contract, never browser pricing as authority. */
export function sponsorshipOfferQuote(
  amountMinor: number,
  version = 'sponsorship-v1',
  quantity = 1,
  formats?: SponsorshipOfferFormatOptions
) {
  const current = createSponsorshipOfferSnapshot(
    amountMinor,
    'CAD',
    undefined,
    formats
  );
  const snapshot = normalizeSponsorshipOfferSnapshot({
    ...current,
    version,
    benefits: current.benefits.map((benefit) => ({ ...benefit, quantity }))
  });
  return {
    ...snapshot,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex')
  };
}

export function registerSponsorshipCommitmentTests() {
  for (const english of [false, true]) {
    const suffix = english ? 'EN mobile @mobile' : 'FR desktop';
    test(`sponsorship offer private delivery evidence preserves dated facts and safe links within its dossier ${suffix} @offer-ui`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      const firstToken = 'a'.repeat(43),
        secondToken = 'b'.repeat(43);
      const deliveredAt = '2026-10-11T12:00:00Z';
      const observedAt = '2026-10-12T10:00:00Z';
      const evidence = {
        id: 'first-dossier-evidence',
        obligationId: 'first-dossier-obligation',
        deliveryId: 'first-dossier-delivery',
        channel: 'facebook' as const,
        target: 'openg20' as const,
        provenance: 'provider_acknowledged' as const,
        deliveredAt,
        externalPostUrl: 'https://www.facebook.com/synthetic-post',
        visibility: 'unknown' as const,
        visibilityObservedAt: null,
        internalReason: 'Private moderation rationale never shown',
        otherContactEmail: 'another-dossier-contact@example.invalid',
        privateStorageKey: 'private/evidence/source-not-for-dom'
      };
      const first = {
        ...fixture(),
        companyName: 'First synthetic dossier',
        fulfilmentEvidence: [
          evidence,
          {
            ...evidence,
            id: 'first-unsafe-evidence',
            channel: 'linkedin' as const,
            provenance: 'provider_verified' as const,
            externalPostUrl: 'javascript:alert("synthetic")',
            visibility: 'changed' as const,
            visibilityObservedAt: observedAt
          }
        ]
      };
      const second = {
        ...fixture(),
        companyName: 'Second synthetic dossier',
        fulfilmentEvidence: [
          {
            ...evidence,
            id: 'second-dossier-evidence',
            channel: 'website' as const,
            target: 'openg7' as const,
            provenance: 'website_verified' as const,
            externalPostUrl:
              'https://synthetic-user:synthetic-password@example.test/post',
            visibility: 'visible' as const,
            visibilityObservedAt: observedAt
          }
        ]
      };
      const reads: string[] = [];
      await mock(page, {
        get: (route) => {
          const requested = new URL(route.request().url()).searchParams.get(
            'token'
          );
          expect([firstToken, secondToken]).toContain(requested);
          reads.push(requested!);
          return json(route, requested === firstToken ? first : second);
        }
      });
      const entry = (token: string) =>
        (english ? '/en' : '') + path + '?token=' + token;
      await page.goto(entry(firstToken));
      const section = page.locator('[data-og7="followup-fulfilment-evidence"]');
      const firstCard = section.locator(
        '[data-og7-id="first-dossier-evidence"]'
      );
      await expect(firstCard).toContainText('OPENG20');
      await expect(firstCard).toContainText(
        english
          ? 'Delivery acknowledged by the provider'
          : 'Envoi confirmé par le fournisseur'
      );
      await expect(firstCard).toContainText(
        english ? 'Visibility unverified' : 'Visibilité non vérifiée'
      );
      await expect(firstCard.locator('time')).toHaveAttribute(
        'datetime',
        deliveredAt
      );
      await expect(firstCard.locator('time')).not.toBeEmpty();
      const link = firstCard.getByRole('link');
      await expect(link).toHaveAttribute('href', evidence.externalPostUrl);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(
        section.locator('[data-og7-id="first-unsafe-evidence"] a')
      ).toHaveCount(0);
      await expect(
        section.locator('[data-og7-id="first-unsafe-evidence"] time').last()
      ).toHaveAttribute('datetime', observedAt);
      await expect(section).toContainText(
        english
          ? 'proves neither presence nor absence'
          : 'ne prouve ni présence ni absence'
      );
      for (const secret of [
        evidence.internalReason,
        evidence.otherContactEmail,
        evidence.privateStorageKey
      ])
        await expect(page.locator('body')).not.toContainText(secret);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="followup-fulfilment-evidence"]')
            .analyze()
        ).violations
      ).toEqual([]);
      await page.goto(entry(secondToken));
      const secondCard = section.locator(
        '[data-og7-id="second-dossier-evidence"]'
      );
      await expect(secondCard).toContainText('OPENG7');
      await expect(secondCard).toContainText(
        english
          ? 'Publication recorded in the OpenG7 directory'
          : 'Publication enregistrée dans l’annuaire OpenG7'
      );
      await expect(secondCard).toContainText(
        english ? 'Visibility verified' : 'Visibilité vérifiée'
      );
      await expect(
        section.locator('[data-og7-id="first-dossier-evidence"]')
      ).toHaveCount(0);
      await expect(section.getByRole('link')).toHaveCount(0);
      await expect(section.locator('time').last()).toHaveAttribute(
        'datetime',
        observedAt
      );
      for (const secret of [
        evidence.internalReason,
        evidence.otherContactEmail,
        evidence.privateStorageKey,
        'synthetic-password'
      ])
        await expect(page.locator('body')).not.toContainText(secret);
      expect(reads).toEqual([firstToken, secondToken]);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="followup-fulfilment-evidence"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
    test(`sponsorship offer current obligations stay separate from accepted terms ${suffix}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      const saved = sponsorshipOfferQuote(50000, 'immutable-original-offer', 4);
      await mock(page, {
        current: {
          ...fixture(),
          commitment: {
            provenance: 'accepted_offer',
            state: 'active',
            offer: saved,
            obligations: [
              {
                id: 'synthetic-obligation',
                channel: 'facebook',
                target: 'openg20',
                ordinal: 1,
                state: 'blocked',
                format: 'individual_portrait',
                version: 3,
                fulfilmentEvidenceId: null,
                blockedReason: 'moderation_review_required'
              }
            ]
          }
        }
      });
      await visit(page, english);
      const summary = page.locator('[data-og7="followup-commitment"]'),
        current = summary.locator('[data-og7="followup-current-obligations"]');
      await expect(
        summary.locator('openg7-sponsorship-offer-summary')
      ).toContainText('immutable-original-offer');
      await expect(current).toContainText('OPENG20');
      await expect(current).toContainText(
        english ? 'Individual portrait' : 'Portrait individuel'
      );
      await expect(current).toContainText(
        english ? 'Editorial review required' : 'Revue éditoriale requise'
      );
      await expect(
        summary.locator('openg7-sponsorship-offer-summary')
      ).not.toContainText('OPENG20');
      await expect(current).not.toContainText('moderation_review_required');
      await expect(current).not.toContainText(
        english ? 'Delivery recorded' : 'Réalisation enregistrée'
      );
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="followup-commitment"]')
            .analyze()
        ).violations
      ).toEqual([]);
    });
    test(`sponsorship offer private follow-up displays frozen server terms without current pricing ${suffix}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      const saved = sponsorshipOfferQuote(25000, 'original-offer-v1', 4);
      await mock(page, {
        current: {
          ...fixture(),
          commitment: {
            provenance: 'accepted_offer',
            state: 'active',
            offer: saved
          }
        }
      });
      let quotes = 0;
      await page.route('**/api/sponsorship-offer?**', (route) => {
        quotes++;
        return route.fulfill({
          json: sponsorshipOfferQuote(25000, 'new-tariff-v2')
        });
      });
      await visit(page, english);
      const summary = page.locator('[data-og7="followup-commitment"]');
      await expect(summary).toContainText('original-offer-v1');
      await expect(summary.locator('li')).toHaveCount(saved.benefits.length);
      await expect(
        summary.locator('[data-og7-id="facebook_batch"] strong')
      ).toContainText('4 ×');
      await expect(summary).toContainText(
        english
          ? 'no fixed publication deadline'
          : 'Aucun délai de publication fixe'
      );
      await expect(summary).not.toContainText('new-tariff-v2');
      expect(quotes).toBe(0);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="followup-commitment"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });

    test(`sponsorship offer historical commitments remain to be clarified until the server qualifies them ${suffix}`, async ({
      page
    }) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      const initial = {
        ...fixture(),
        sponsorshipBenefits: [],
        commitment: {
          provenance: 'historical_unverified' as const,
          state: 'needs_confirmation' as const,
          offer: null
        }
      };
      let current = initial as ReturnType<typeof fixture>;
      await mock(page, { current, get: (route) => json(route, current) });
      await visit(page, english);
      const summary = page.locator('[data-og7="followup-commitment"]');
      await expect(summary).toContainText(
        english
          ? 'does not mean that no benefit was agreed'
          : 'ne signifie pas qu’aucune prestation n’a été convenue'
      );
      await expect(summary.getByRole('status')).toBeVisible();
      await expect(summary.locator('li')).toHaveCount(0);
      current = {
        ...current,
        commitment: {
          provenance: 'qualified_historical',
          state: 'active',
          offer: sponsorshipOfferQuote(25000, 'qualified-history-v1', 2)
        }
      };
      await page
        .locator('[data-og7="followup-next-step"]')
        .getByRole('button', {
          name: english ? 'Refresh status' : 'Actualiser le statut',
          exact: true
        })
        .click();
      await expect(summary).toContainText('qualified-history-v1');
      await expect(summary).toContainText(
        english ? 'clarified and recorded' : 'clarifiées et consignées'
      );
      await expect(summary.getByRole('status')).toHaveCount(0);
      await expect(
        summary.locator('[data-og7-id="website_mention"] strong')
      ).toContainText('2 ×');
    });
  }
}

export function registerSponsorshipOfferTests(
  enableSponsorship: (page: Page) => Promise<void>
) {
  for (const english of [false, true]) {
    const suffix = english ? 'EN mobile' : 'FR desktop';
    const setup = async (page: Page) => {
      await page.setViewportSize(
        english ? { width: 390, height: 844 } : { width: 1280, height: 900 }
      );
      await enableSponsorship(page);
    };
    const open = async (page: Page) => {
      await page.goto(
        (english ? '/en' : '') + '/fonds-des-batisseurs?intent=sponsorship'
      );
      const form = page.locator('[data-og7="contribution-form"]');
      await form
        .getByLabel(
          english
            ? /OpenG7 is an independent project/
            : /OpenG7 est un projet indépendant/
        )
        .check();
      return {
        form,
        offer: form.locator('[data-og7="sponsorship-offer"]'),
        acceptance: form.locator('[data-og7="offer-acceptance"]'),
        submit: form.locator('button[type="submit"]')
      };
    };

    test(
      `sponsorship offer changing format requires fresh exact terms and keeps an uncertain retry ${suffix}`,
      { tag: '@offer-ui' },
      async ({ page }) => {
        await setup(page);
        const requests: Record<string, unknown>[] = [],
          quotes: SponsorshipOfferFormatOptions[] = [];
        await page.route('**/api/sponsorship-offer?**', (route) => {
          const params = new URL(route.request().url()).searchParams;
          const formats = {
            ...(params.has('facebookFormat')
              ? {
                  facebook: params.get(
                    'facebookFormat'
                  ) as 'individual_portrait'
                }
              : {})
          };
          quotes.push(formats);
          return route.fulfill({
            json: sponsorshipOfferQuote(
              Number(params.get('amountMinor')),
              'sponsorship-v2',
              1,
              formats
            )
          });
        });
        await page.route('**/api/checkout-sessions', (route) => {
          requests.push(route.request().postDataJSON());
          return requests.length === 1
            ? route.fulfill({
                status: 503,
                json: { error: 'Synthetic uncertain result' }
              })
            : route.fulfill({
                json: {
                  status: 'mocked',
                  checkoutId: 'synthetic-format-retry',
                  redirectUrl: 'https://example.test/unused'
                }
              });
        });
        const { form, offer, acceptance, submit } = await open(page);
        await form.locator('#custom-contribution').fill('500');
        await expect(offer).toContainText(
          english ? 'Collective text' : 'Texte collectif'
        );
        await acceptance.check();
        await form
          .locator('[data-og7-id="offer-format:facebook"]')
          .selectOption('individual_portrait');
        await expect(offer).toContainText(
          english ? 'Individual portrait' : 'Portrait individuel'
        );
        await expect(acceptance).not.toBeChecked();
        await expect(submit).toBeDisabled();
        const quote = sponsorshipOfferQuote(50000, 'sponsorship-v2', 1, {
          facebook: 'individual_portrait'
        });
        await acceptance.check();
        await submit.click();
        await expect.poll(() => requests.length).toBe(1);
        await expect(submit).toBeEnabled();
        const lastQuoteCount = quotes.length;
        await submit.click();
        await expect.poll(() => requests.length).toBe(2);
        expect(requests[1]).toEqual(requests[0]);
        expect(requests[0].offerFormats).toEqual({
          facebook: 'individual_portrait'
        });
        expect(requests[0].offerAcceptance).toEqual({
          version: quote.version,
          fingerprint: quote.fingerprint
        });
        expect(quotes).toHaveLength(lastQuoteCount);
        await expect(
          form.locator(
            '[data-og7-id="offer-format:facebook"] option[value="image_collection"]'
          )
        ).toHaveJSProperty('disabled', true);
      }
    );

    test(
      `sponsorship offer requires fresh human acceptance when the server terms change ${suffix}`,
      { tag: '@offer-ui' },
      async ({ page }) => {
        await setup(page);
        let version = 1;
        const requests: Record<string, unknown>[] = [];
        await page.route('**/api/sponsorship-offer?**', (route) =>
          route.fulfill({
            json: sponsorshipOfferQuote(
              Number(
                new URL(route.request().url()).searchParams.get('amountMinor')
              ),
              `sponsorship-v${version}`,
              version
            )
          })
        );
        await page.route('**/api/checkout-sessions', (route) => {
          requests.push(route.request().postDataJSON());
          if (requests.length === 1) {
            version = 2;
            return route.fulfill({
              status: 409,
              json: { code: 'SPONSORSHIP_OFFER_CHANGED' }
            });
          }
          return route.fulfill({
            json: {
              status: 'mocked',
              checkoutId: 'synthetic-offer-current',
              redirectUrl: 'https://example.test/unused'
            }
          });
        });
        const { form, offer, acceptance, submit } = await open(page);
        await expect(offer).toContainText('sponsorship-v1');
        await expect(offer).toContainText(
          english
            ? 'no fixed publication deadline'
            : 'Aucun délai de publication fixe'
        );
        await expect(offer).toContainText(
          english
            ? 'no fixed exposure duration'
            : 'Aucune durée d’exposition fixe'
        );
        await expect(submit).toBeDisabled();
        await acceptance.check();
        await submit.click();
        await expect(offer).toContainText('sponsorship-v2');
        await expect(
          offer.locator('[data-og7-id="website_mention"] strong')
        ).toContainText('2 ×');
        await expect(acceptance).not.toBeChecked();
        await expect(submit).toBeDisabled();
        await form.dispatchEvent('submit');
        expect(requests).toHaveLength(1);
        await acceptance.check();
        await submit.click();
        await expect.poll(() => requests.length).toBe(2);
        for (const index of [0, 1]) {
          const quoted = sponsorshipOfferQuote(
            5000,
            `sponsorship-v${index + 1}`,
            index + 1
          );
          expect(requests[index].offerAcceptance).toEqual({
            version: quoted.version,
            fingerprint: quoted.fingerprint
          });
        }
        expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
        expect(requests[1]).not.toHaveProperty('offerQuote');
      }
    );

    test(
      `sponsorship offer resumes an uncertain submission without replacing its quote or payment key ${suffix}`,
      { tag: '@offer-ui' },
      async ({ page }) => {
        await setup(page);
        let quotes = 0;
        let version = 1;
        const requests: Record<string, unknown>[] = [];
        await page.route('**/api/sponsorship-offer?**', (route) => {
          quotes++;
          return route.fulfill({
            json: sponsorshipOfferQuote(
              Number(
                new URL(route.request().url()).searchParams.get('amountMinor')
              ),
              `sponsorship-v${version}`
            )
          });
        });
        await page.route('**/api/checkout-sessions', (route) => {
          requests.push(route.request().postDataJSON());
          return requests.length === 1
            ? route.fulfill({
                status: 503,
                json: { code: 'SYNTHETIC_LOST_RESPONSE' }
              })
            : route.fulfill({
                json: {
                  status: 'mocked',
                  checkoutId: 'synthetic-exact-retry',
                  redirectUrl: 'https://example.test/unused'
                }
              });
        });
        const { form, offer, acceptance, submit } = await open(page);
        await form.locator('#custom-contribution').fill('250');
        await expect(offer).toContainText(/250[,.]00/);
        await expect(offer).toContainText('sponsorship-v1');
        await acceptance.check();
        await submit.click();
        await expect(form.getByRole('alert')).toBeVisible();
        expect(requests).toHaveLength(1);
        const quoteCount = quotes;
        version = 2;
        await page.reload();
        await expect(offer).toContainText('sponsorship-v1');
        await expect(offer).toContainText(
          english
            ? 'resuming a submitted attempt'
            : 'reprenez une tentative déjà soumise'
        );
        await expect(acceptance).not.toBeChecked();
        await expect(submit).toBeDisabled();
        await offer
          .getByRole('button', {
            name: english ? /Resume the/ : /Reprendre la/
          })
          .click();
        await expect(form.locator('#custom-contribution')).toHaveValue('');
        await expect(offer).toContainText('sponsorship-v1');
        await form
          .getByLabel(
            english
              ? /OpenG7 is an independent project/
              : /OpenG7 est un projet indépendant/
          )
          .check();
        await acceptance.check();
        await submit.click();
        await expect.poll(() => requests.length).toBe(2);
        expect(requests[1]).toEqual(requests[0]);
        expect(quotes).toBe(quoteCount);
        await expect(
          form
            .getByRole('status')
            .filter({ hasText: english ? /Local mode/ : /Mode local/ })
        ).toBeVisible();
        expect(
          await page.evaluate(() =>
            sessionStorage.getItem('openg7.checkout-offer-recovery.v1')
          )
        ).toBeNull();
      }
    );

    test(
      `sponsorship offer clears loading and failed contexts before accepting another amount ${suffix}`,
      { tag: '@offer-ui' },
      async ({ page }) => {
        await setup(page);
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let heldRequests = 0;
        let failCurrent = true;
        await page.route('**/api/sponsorship-offer?**', async (route) => {
          const amountMinor = Number(
            new URL(route.request().url()).searchParams.get('amountMinor')
          );
          if (amountMinor === 5000) {
            heldRequests++;
            await held;
            return route
              .fulfill({ json: sponsorshipOfferQuote(5000, 'stale-offer') })
              .catch(() => {});
          }
          return failCurrent
            ? route.fulfill({ status: 503, json: {} })
            : route.fulfill({
                json: sponsorshipOfferQuote(amountMinor, 'current-offer', 2)
              });
        });
        let checkouts = 0;
        await page.route('**/api/checkout-sessions', (route) => {
          checkouts++;
          return route.fulfill({ status: 503, json: {} });
        });
        const { form, offer, acceptance, submit } = await open(page);
        try {
          await expect.poll(() => heldRequests).toBe(1);
          await expect(offer).toHaveAttribute('aria-busy', 'true');
          await expect(submit).toBeDisabled();
          await form.locator('#custom-contribution').fill('250');
          await expect(offer.getByRole('alert')).toBeVisible();
          await expect(acceptance).toHaveCount(0);
          await expect(submit).toBeDisabled();
          failCurrent = false;
          await offer
            .getByRole('button', { name: english ? /Try again/ : /Réessayer/ })
            .click();
          await expect(offer).toContainText('current-offer');
          release();
          await expect(offer).not.toContainText('stale-offer');
          await expect(
            offer.locator('[data-og7-id="website_mention"] strong')
          ).toContainText('2 ×');
          await expect(acceptance).not.toBeChecked();
          await expect(submit).toBeDisabled();
          await acceptance.focus();
          await page.keyboard.press('Space');
          await expect(acceptance).toBeChecked();
          await expect(submit).toBeEnabled();
          await form.locator('#custom-contribution').fill('-50');
          await expect(offer).toHaveCount(0);
          await expect(submit).toBeDisabled();
          await form.dispatchEvent('submit');
          expect(checkouts).toBe(0);
        } finally {
          release();
        }
      }
    );
  }
}
