import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

// Covers informational public content and the shared music control:
// translated copy, links and explicit playback on quiet routes
// (funding-about-page, ecosystem-page, boutique-page, music-page
// components). French copy in this codebase uses a curly apostrophe (’),
// so text assertions below match around it with a `.` wildcard instead of
// hardcoding the character.

interface MusicPlaybackProbe {
  plays: number;
  pauses: number;
}

function musicPlayback(page: Page): Promise<MusicPlaybackProbe> {
  return page.evaluate(
    () =>
      (window as unknown as { __og7MusicPlayback: MusicPlaybackProbe })
        .__og7MusicPlayback
  );
}

test.describe('Shared site music route parity', () => {
  test.beforeEach(async ({ page }) => {
    // Install before Angular bootstraps so blocked autoplay cannot hide a play attempt.
    await page.addInitScript(() => {
      const probe = { plays: 0, pauses: 0 };
      Object.defineProperty(window, '__og7MusicPlayback', { value: probe });
      class FakeAudio extends EventTarget {
        loop = false;
        preload = '';
        volume = 1;
        constructor() {
          super();
        }
        play(): Promise<void> {
          probe.plays++;
          return Promise.resolve();
        }
        pause(): void {
          probe.pauses++;
        }
      }
      Object.defineProperty(window, 'Audio', {
        configurable: true,
        writable: true,
        value: FakeAudio
      });
    });
  });

  for (const path of ['/music', '/boutique', '/en/music', '/en/boutique']) {
    test(`site music starts only on explicit request at ${path}`, async ({
      page
    }) => {
      const english = path.startsWith('/en/');
      const playLabel = english ? 'Start music' : 'Lancer la musique';
      const stopLabel = english ? 'Stop music' : 'Couper la musique';
      for (const suffix of ['', '/?audio-parity=1#music-control']) {
        await page.goto(path + suffix);
        const toggle = page.locator('openg7-site-music').getByRole('button');
        await expect(toggle).toHaveAccessibleName(playLabel);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(await musicPlayback(page)).toEqual({ plays: 0, pauses: 0 });

        await page.locator('main').getByRole('heading', { level: 1 }).click();
        await page.keyboard.press('Tab');
        expect(await musicPlayback(page)).toEqual({ plays: 0, pauses: 0 });

        await toggle.focus();
        await toggle.press('Enter');
        await expect(toggle).toHaveAccessibleName(stopLabel);
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(await musicPlayback(page)).toEqual({ plays: 1, pauses: 0 });

        await toggle.press('Enter');
        await expect(toggle).toHaveAccessibleName(playLabel);
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await page.keyboard.press('Tab');
        expect(await musicPlayback(page)).toEqual({ plays: 1, pauses: 1 });
      }
    });
  }

  for (const path of ['/ecosystem', '/en/ecosystem']) {
    test(`site music preserves automatic playback outside quiet routes at ${path}`, async ({
      page
    }) => {
      await page.goto(path);
      const toggle = page.locator('openg7-site-music').getByRole('button');
      await expect(toggle).toHaveAccessibleName(
        path.startsWith('/en/') ? 'Stop music' : 'Couper la musique'
      );
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect((await musicPlayback(page)).plays).toBeGreaterThan(0);
      await toggle.focus();
      await toggle.press('Enter');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect((await musicPlayback(page)).pauses).toBe(1);
    });
  }
});

test.describe('Docker funding about page', () => {
  test('renders the hero and links to the ecosystem and home sections', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/a-propos');

    await expect(page.locator('#about-title')).toContainText('OpenG7');
    await expect(
      page.getByText('Une vision ouverte. Des fondations partagées.')
    ).toBeVisible();

    await page
      .getByRole('link', { name: 'Découvrir OpenG7', exact: true })
      .click();
    await expect(page).toHaveURL(/\/ecosystem$/);

    await page.goto('/fonds-des-batisseurs/a-propos');
    await page
      .getByRole('link', { name: 'Comprendre le fonds', exact: true })
      .click();
    await expect(page).toHaveURL(/#funding-purpose$/);

    await page.goto('/fonds-des-batisseurs/a-propos');
    await page
      .getByRole('link', { name: 'Soutenir le projet', exact: true })
      .click();
    await expect(page).toHaveURL(/#support$/);
  });

  test('renders the English mirror', async ({ page }) => {
    await page.goto('/en/fonds-des-batisseurs/a-propos');

    await expect(
      page.getByText('An open vision. Shared foundations.')
    ).toBeVisible();
  });
});

test.describe('Docker ecosystem page', () => {
  test('renders the hero and jumps to the platforms, connections, and support sections', async ({
    page
  }) => {
    await page.goto('/ecosystem');

    await expect(page.locator('#ecosystem-title')).toContainText(/écosystème/i);

    // "Explorer les plateformes"/"Voir les connexions" also appear in a
    // repeated CTA block further down the page, hence .first().
    await page
      .getByRole('link', { name: 'Explorer les plateformes', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/ecosystem#platforms$/);

    await page.goto('/ecosystem');
    await page
      .getByRole('link', { name: 'Voir les connexions', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/ecosystem#connections$/);

    await page.goto('/ecosystem');
    await page
      .getByRole('link', { name: /Soutenir l.écosystème/i })
      .first()
      .click();
    await expect(page).toHaveURL(/#support$/);
  });

  test('exposes a platform repository link in a new tab', async ({ page }) => {
    await page.goto('/ecosystem');

    const repositoryLink = page
      .getByRole('link', { name: 'Explorer', exact: true })
      .first();
    await expect(repositoryLink).toHaveAttribute('href', /github\.com\/OpenG7/);
    await expect(repositoryLink).toHaveAttribute('target', '_blank');
  });
});

test.describe('Docker boutique page', () => {
  test('renders the coming-soon hero and links out to the NorthDragon store', async ({
    page
  }) => {
    await page.goto('/boutique');

    await expect(page.locator('#boutique-title')).toContainText('NorthDragon');

    const storeLink = page.locator('main a[href*="northdragon.org"]').first();
    await expect(storeLink).toBeVisible();
    await expect(storeLink).toHaveAttribute('href', /northdragon\.org/);
    await expect(storeLink).toHaveAttribute('target', '_blank');
  });
});

test.describe('Docker music page', () => {
  test('renders the coming-soon hero with a disabled listen button', async ({
    page
  }) => {
    await page.goto('/music');

    await expect(page.locator('#music-title')).toContainText(
      'Chants du Dragon'
    );
    await expect(
      page.getByRole('button', { name: /.couter l.album/i })
    ).toBeDisabled();
  });

  test('the home and ecosystem links stay on the French locale', async ({
    page
  }) => {
    await page.goto('/music');
    await page.getByRole('link', { name: /Retour . l.accueil/i }).click();
    await expect(page).toHaveURL(/\/(fonds-des-batisseurs)?$/);

    await page.goto('/music');
    await page.getByRole('link', { name: /D.couvrir l.écosystème/i }).click();
    await expect(page).toHaveURL(/\/ecosystem$/);
  });

  // Regression coverage for a bug this suite caught: the home/ecosystem
  // CTAs used to hard-code routerLink="/" and routerLink="/ecosystem"
  // instead of the i18n-aware path helpers every other public page uses
  // (see funding-about-page's homePath()/ecosystemPath() above), which
  // dropped the "en/" prefix on the English mirror. Fixed in
  // music-page.component.ts alongside this test.
  test('the home and ecosystem links keep the English locale prefix on the English mirror', async ({
    page
  }) => {
    await page.goto('/en/music');
    await page.getByRole('link', { name: 'Return home', exact: true }).click();
    await expect(page).toHaveURL(/\/en(\/fonds-des-batisseurs)?$/);

    await page.goto('/en/music');
    await page
      .getByRole('link', { name: 'Discover the ecosystem', exact: true })
      .click();
    await expect(page).toHaveURL(/\/en\/ecosystem$/);
  });
});
