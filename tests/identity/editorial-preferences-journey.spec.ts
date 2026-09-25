import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type {
  PilotCommand,
  ProgrammeState,
  PublicationAutomationState
} from '@openg7/funding-core';

import { startIdentityStack } from './stack.mjs';

test('editorial variants: exact review, distinct observations and explicit preferences preserve human decisions', async ({
  playwright
}, info) => {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  const anonymous = await playwright.request.newContext({
    baseURL: stack.origin
  });
  const headers = { Origin: stack.origin };
  const feedId = 'openg7:facebook';
  const endpoint = '/api/admin/publication-automation';
  const commandUrl = '/api/admin/pilotage/command';
  const variantUrl = '/api/admin/pilotage/variant';
  const programmeUrl = '/api/admin/pilotage/programme';
  const programme = (page: Page) =>
    page.locator('[data-og7="editorial-programme"]');
  const open = async (role: string) => {
    const context = await playwright.chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), 'og7-editorial-browser-')),
      { baseURL: stack.origin, viewport: { width: 1280, height: 1000 } }
    );
    contexts.push(context);
    const page = context.pages()[0]!;
    page.setDefaultTimeout(10000);
    await page.goto('/admin/login?returnUrl=%2Fadmin%2Ffundraiser%2Fpilotage');
    await page.locator('[data-og7="identity-sign-in"]').click();
    await page.getByLabel('Compte de test').selectOption(role);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL(/\/admin\/fundraiser\/pilotage/);
    return page;
  };
  const show = async (page: Page, view: string) => {
    if (!(await programme(page).isVisible()))
      await page.locator('[data-og7="open-programme"]').click();
    await expect(programme(page)).toHaveAttribute('aria-busy', 'false');
    await programme(page)
      .getByRole('button', { name: view, exact: true })
      .click();
  };
  const refresh = async (page: Page) => {
    await programme(page)
      .getByRole('button', { name: 'Actualiser', exact: true })
      .click();
    await expect(programme(page)).toHaveAttribute('aria-busy', 'false');
  };
  const confirmation = (page: Page) =>
    programme(page).locator('[data-og7="programme-confirmation"]');
  const commands: PilotCommand[] = [];
  const errors: string[] = [];
  try {
    const owner = await open('owner');
    const mutate = async (data: object) => {
      const response = await owner.request.post(endpoint, { headers, data });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const state = async (): Promise<PublicationAutomationState> =>
      (await owner.request.get(endpoint)).json();
    const editorial = async (): Promise<ProgrammeState> =>
      (await owner.request.get(programmeUrl)).json();
    const profile = async () =>
      (await editorial()).profiles.find((p) => p.feedId === feedId)!;
    const record = async (id: string) =>
      (await state()).deliveries.find((d) => d.id === id)!;
    const facts = async () => ({
      deliveries: (
        await stack.pool.query(
          'SELECT * FROM publication_deliveries ORDER BY id'
        )
      ).rows,
      profiles: (
        await stack.pool.query(
          'SELECT * FROM publication_editorial_profiles ORDER BY feed_id'
        )
      ).rows,
      observations: (
        await stack.pool.query(
          'SELECT * FROM publication_editorial_observations ORDER BY delivery_id,intent'
        )
      ).rows
    });
    const effects = async () =>
      (
        await stack.pool.query(`SELECT
      (SELECT count(*) FROM admin_command_receipts) receipts,
      (SELECT count(*) FROM admin_audit_log) audits,
      (SELECT count(*) FROM email_messages) emails,
      (SELECT count(*) FROM social_publication_jobs) jobs`)
      ).rows[0];
    const command = (
      action: PilotCommand['action'],
      targetId: string,
      version: number,
      payload: PilotCommand['payload']
    ): PilotCommand => ({
      requestId: randomUUID(),
      action,
      targetId,
      confirmation: targetId,
      version: String(version),
      payload
    });
    for (const role of ['operator', 'reader']) {
      expect(
        (
          await owner.request.post('/api/admin/access', {
            headers,
            data: {
              subject: 'fixture-' + role,
              confirmation: 'fixture-' + role,
              displayName: role,
              role,
              disabled: false
            }
          })
        ).status()
      ).toBe(200);
    }
    await mutate({ action: 'check', feedId });
    const messages = ['A', 'B', 'C'].map(
      (letter) =>
        `Merci à Atelier fictif ${letter}\n\nLe projet avance. Ensemble, nous avançons.\n\nObjectif : 50 CAD. https://example.test/projet\n\nCommandite rémunérée.`
    );
    const ids: string[] = [];
    for (const [i, message] of messages.entries())
      ids.push(
        (
          await mutate({
            action: 'compose',
            feedId,
            kind: 'news',
            message,
            scheduledAt: new Date(
              Date.now() + (i + 10) * 86400000
            ).toISOString()
          })
        ).id
      );
    await mutate({
      action: 'approve',
      id: ids[0],
      version: 1,
      confirmation: ids[0]
    });
    const operator = await open('operator');
    const reader = await open('reader');
    operator.on('pageerror', (e) => errors.push(e.message));
    operator.on('request', (r) => {
      if (r.url().endsWith(commandUrl) && r.method() === 'POST')
        commands.push(r.postDataJSON());
    });
    const transform = async (id: string, intent = 'Ton neutre') => {
      await show(operator, 'Variante de texte');
      await programme(operator)
        .getByRole('combobox', { name: /^Publication/ })
        .selectOption(id);
      const response = operator.waitForResponse((r) =>
        r.url().endsWith(variantUrl)
      );
      await programme(operator)
        .getByRole('button', { name: intent, exact: true })
        .click();
      expect((await response).status()).toBe(200);
      await expect(
        programme(operator).locator('[data-og7="programme-comparison"]')
      ).toBeVisible();
    };
    const confirm = async () => {
      const response = operator.waitForResponse((r) =>
        r.url().endsWith(commandUrl)
      );
      await confirmation(operator)
        .getByRole('button', { name: 'Confirmer l’enregistrement' })
        .click();
      expect((await response).status()).toBe(200);
      const receipt = await (await response).json();
      await expect(programme(operator)).not.toBeVisible();
      return receipt;
    };
    const saveVariant = async (id: string) => {
      await transform(id);
      await programme(operator)
        .getByRole('button', { name: 'Examiner cette variante' })
        .click();
      expect((await confirm()).status).toBe('completed');
    };
    const baseline = await effects();

    await test.step('private previews preserve facts and require an operator, without observations or mutations', async () => {
      const before = await facts();
      expect(
        (
          await anonymous.post(variantUrl, {
            headers,
            data: { id: ids[0], version: 1, instruction: 'neutral' }
          })
        ).status()
      ).toBe(401);
      await show(reader, 'Variante de texte');
      await expect(
        programme(reader).getByRole('button', {
          name: 'Ton neutre',
          exact: true
        })
      ).toBeDisabled();
      for (const path of [
        variantUrl,
        stack.apiOrigin + '/admin/pilotage/variant'
      ]) {
        const data = {
          id: ids[0],
          version: (await record(ids[0])).version,
          instruction: 'neutral'
        };
        expect(
          (await reader.request.post(path, { headers, data })).status()
        ).toBe(403);
        expect(
          (
            await operator.request.post(path, {
              headers: { Origin: 'https://elsewhere.example.test' },
              data
            })
          ).status()
        ).toBe(403);
        const response = await operator.request.post(path, { headers, data });
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toContain('no-store');
      }
      const variants = [
        ['Ton neutre', messages[0].replace('Merci à ', 'Partenaire : ')],
        ['Raccourcir', messages[0].replace(' Ensemble, nous avançons.', '')],
        [
          'Le projet en premier',
          [1, 2, 0, 3]
            .map((index) => messages[0].split('\n\n')[index])
            .join('\n\n')
        ],
        [
          'Introduction LinkedIn',
          messages[0].replace('Merci à ', 'Un partenaire engagé : ')
        ]
      ];
      for (const [label, expected] of variants) {
        await transform(ids[0], label);
        const comparison = programme(operator).locator(
          '[data-og7="programme-comparison"]'
        );
        await expect(comparison.locator('section').first()).toContainText(
          messages[0].split('\n\n')[0]
        );
        expect(
          await comparison
            .locator('section')
            .last()
            .locator('p')
            .allTextContents()
        ).toEqual(expected.split('\n\n'));
      }
      await programme(operator)
        .getByRole('textbox', { name: 'Mon intention' })
        .fill('Publier et rembourser');
      await programme(operator)
        .getByRole('button', { name: 'Préparer la variante', exact: true })
        .click();
      await expect(programme(operator).getByRole('alert')).toContainText(
        'quatre transformations'
      );
      await expect(
        programme(operator).locator('[data-og7="programme-comparison"]')
      ).toHaveCount(0);
      await transform(ids[0]);
      await programme(operator)
        .getByRole('button', { name: 'Examiner cette variante' })
        .click();
      await confirmation(operator)
        .getByRole('button', { name: 'Revenir à la proposition' })
        .click();
      await programme(operator)
        .getByRole('button', { name: 'Examiner cette variante' })
        .click();
      await programme(operator)
        .getByRole('textbox', { name: 'Mon intention' })
        .fill('Raccourcir');
      await expect(confirmation(operator)).toHaveCount(0);
      await expect(
        programme(operator).locator('[data-og7="programme-comparison"]')
      ).toHaveCount(0);
      expect(await facts()).toEqual(before);
      expect(await effects()).toEqual(baseline);
      expect(commands).toHaveLength(0);
    });

    await test.step('forged text and stale review cannot count as accepted corrections', async () => {
      const current = await record(ids[0]);
      const forged = command('publication.edit', current.id, current.version, {
        message: 'Un fait inventé',
        scheduledAt: current.scheduledAt,
        mediaId: null,
        editorialIntent: 'neutral'
      });
      const before = await facts();
      expect(
        (
          await reader.request.post(commandUrl, { headers, data: forged })
        ).status()
      ).toBe(403);
      expect(
        (
          await operator.request.post(commandUrl, {
            headers,
            data: { ...forged, confirmation: '' }
          })
        ).status()
      ).toBe(400);
      expect(
        await (
          await operator.request.post(commandUrl, { headers, data: forged })
        ).json()
      ).toMatchObject({ status: 'failed', code: 'VARIANT_CHANGED' });
      expect(await facts()).toEqual(before);
      await transform(ids[0]);
      await programme(operator)
        .getByRole('button', { name: 'Examiner cette variante' })
        .click();
      await mutate({
        action: 'edit',
        id: current.id,
        version: current.version,
        message: current.message,
        scheduledAt: new Date(Date.now() + 14 * 86400000).toISOString(),
        mediaId: null
      });
      const changed = await facts();
      expect(await confirm()).toMatchObject({
        status: 'failed',
        code: 'VERSION_CONFLICT'
      });
      await expect(operator.getByRole('alert')).toContainText(
        'Le dossier a changé'
      );
      expect(await facts()).toEqual(changed);
      // Restore an approval before accepting a variant, to check revocation.
      const a = await record(ids[0]);
      await mutate({
        action: 'approve',
        id: a.id,
        version: a.version,
        confirmation: a.id
      });
    });

    await test.step('three distinct saved corrections create a suggestion, without enabling a preference', async () => {
      const original = await record(ids[0]);
      await saveVariant(ids[0]);
      let a = await record(ids[0]);
      expect(a).toMatchObject({
        message: messages[0].replace('Merci à ', 'Partenaire : '),
        status: 'draft',
        approvedAt: null
      });
      expect(a).toMatchObject({
        feedId: original.feedId,
        scheduledAt: original.scheduledAt,
        mediaId: original.mediaId
      });
      expect((await profile()).observations.neutral).toBe(1);
      const beforeReplay = await facts();
      const beforeEffects = await effects();
      expect(
        (
          await (
            await operator.request.post(commandUrl, {
              headers,
              data: commands.at(-1)
            })
          ).json()
        ).status
      ).toBe('completed');
      expect(await facts()).toEqual(beforeReplay);
      expect(await effects()).toEqual(beforeEffects);
      await transform(ids[0]);
      await expect(
        programme(operator).getByRole('button', {
          name: 'Examiner cette variante'
        })
      ).toBeDisabled();
      await expect(programme(operator)).toContainText(
        'Aucune correction ne sera comptée'
      );
      await show(operator, 'Préférences');
      await expect(
        programme(operator).getByText(
          'Cette correction revient régulièrement.',
          { exact: false }
        )
      ).toHaveCount(0);
      // Close and reload before accepting another version of the same publication.
      await operator.reload();
      await mutate({
        action: 'edit',
        id: a.id,
        version: a.version,
        message: messages[0],
        scheduledAt: a.scheduledAt,
        mediaId: null
      });
      await saveVariant(ids[0]);
      expect((await profile()).observations.neutral).toBe(1);
      for (const id of ids.slice(1)) await saveVariant(id);
      expect(await profile()).toMatchObject({
        observations: { neutral: 3 },
        preferences: []
      });
      await show(operator, 'Préférences');
      await expect(
        programme(operator).getByText(
          'Cette correction revient régulièrement.',
          { exact: false }
        )
      ).toBeVisible();
      await expect(
        programme(operator).getByRole('checkbox', { name: 'Ton neutre' })
      ).not.toBeChecked();
      a = await record(ids[0]);
      await mutate({
        action: 'approve',
        id: a.id,
        version: a.version,
        confirmation: a.id
      });
    });

    // Synthetic already-paid records only in the disposable DB; this recipe does not exercise Stripe.
    const seedSponsor = async (name: string) => {
      await stack.pool.query(
        `INSERT INTO fund_contributions
        (id,contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_target,sponsor_feed_channels)
        VALUES($1,'sponsorship_interest',25000,'CAD','paid',TRUE,'approved',$2,'Le projet avance. Ensemble, nous avançons.','openg7','["facebook"]')`,
        [randomUUID(), name]
      );
    };
    await mutate({
      action: 'settings',
      settings: {
        id: feedId,
        paused: true,
        autoPrepare: true,
        timezone: 'America/Toronto',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        localTime: '09:00',
        capacity: 1,
        horizonDays: 14
      }
    });
    for (const suffix of ['Humain', 'Refusé', 'Intact'])
      await seedSponsor('Atelier fictif ' + suffix);
    await mutate({ action: 'prepare', feedId });
    const automatic = (await state()).deliveries.filter((d) => d.autoManaged);
    expect(automatic).toHaveLength(3);
    const [human, rejected, untouched] = automatic;
    await mutate({
      action: 'edit',
      id: human.id,
      version: human.version,
      message: 'Texte humain conservé. Commandite rémunérée.',
      scheduledAt: human.scheduledAt,
      mediaId: null
    });
    await mutate({
      action: 'reject',
      id: rejected.id,
      version: rejected.version,
      confirmation: rejected.id,
      reason: 'Refus synthétique de recette'
    });
    const protectedIds = [...ids, human.id, rejected.id];
    const protectedBefore = (await facts()).deliveries.filter((d) =>
      protectedIds.includes(d.id)
    );
    const otherProfiles = (await editorial()).profiles.filter(
      (p) => p.feedId !== feedId
    );

    await test.step('preference cancellation, concurrent change and lost response preserve explicit intent', async () => {
      await refresh(operator);
      await programme(operator)
        .getByRole('checkbox', { name: 'Ton neutre' })
        .check();
      const before = await facts();
      await programme(operator)
        .getByRole('button', { name: 'Examiner mes préférences' })
        .click();
      await confirmation(operator)
        .getByRole('button', { name: 'Revenir à la proposition' })
        .click();
      expect(await facts()).toEqual(before);
      await programme(operator)
        .getByRole('button', { name: 'Examiner mes préférences' })
        .click();
      const p = await profile();
      expect(
        (
          await (
            await owner.request.post(commandUrl, {
              headers,
              data: command('editorial.preferences', feedId, p.version, {
                preferences: ['concise']
              })
            })
          ).json()
        ).status
      ).toBe('completed');
      expect(await confirm()).toMatchObject({
        status: 'failed',
        code: 'VERSION_CONFLICT'
      });
      expect((await profile()).preferences).toEqual(['concise']);
      await show(operator, 'Préférences');
      await programme(operator)
        .getByRole('checkbox', { name: 'Raccourcir' })
        .uncheck();
      await programme(operator)
        .getByRole('checkbox', { name: 'Ton neutre' })
        .check();
      const commandsBefore = commands.length;
      let persisted = false;
      await operator.route(
        '**/api/admin/pilotage/command',
        async (route) => {
          const response = await route.fetch({ maxRetries: 0 });
          expect((await response.json()).status).toBe('completed');
          persisted = true;
          await route.abort('failed');
        },
        { times: 1 }
      );
      await programme(operator)
        .getByRole('button', { name: 'Examiner mes préférences' })
        .click();
      await confirmation(operator)
        .getByRole('button', { name: 'Confirmer l’enregistrement' })
        .focus();
      await operator.keyboard.press('Enter');
      await expect(
        operator.getByRole('button', {
          name: 'Vérifier le résultat',
          exact: true
        })
      ).toBeVisible();
      await operator.reload();
      await expect(
        operator.locator('[data-og7="pilot-receipt"]')
      ).toBeVisible();
      expect(persisted).toBe(true);
      expect(commands).toHaveLength(commandsBefore + 1);
      const saved = await profile();
      expect(saved.preferences).toEqual(['neutral']);
      expect(
        (
          await (
            await operator.request.post(commandUrl, {
              headers,
              data: commands.at(-1)
            })
          ).json()
        ).status
      ).toBe('completed');
      expect(await profile()).toEqual(saved);
      expect(
        (await facts()).deliveries.filter((d) => protectedIds.includes(d.id))
      ).toEqual(protectedBefore);
    });

    await test.step('preparation uses enabled preferences only for intact drafts and disabling them preserves reviewed work', async () => {
      await seedSponsor('Atelier fictif Nouveau');
      await mutate({ action: 'prepare', feedId });
      expect((await record(untouched.id)).message).toMatch(/^Partenaire : /);
      const newDelivery = (await state()).deliveries.find((d) =>
        d.sponsors.some((s) => s.name === 'Atelier fictif Nouveau')
      )!;
      expect(newDelivery.message).toMatch(/^Partenaire : /);
      expect(newDelivery.status).toBe('draft');
      expect(
        (await facts()).deliveries.filter((d) => protectedIds.includes(d.id))
      ).toEqual(protectedBefore);
      await show(operator, 'Préférences');
      await expect(
        programme(operator).getByRole('checkbox', { name: 'Ton neutre' })
      ).toBeChecked();
      await programme(operator)
        .getByRole('checkbox', { name: 'Ton neutre' })
        .uncheck();
      await programme(operator)
        .getByRole('button', { name: 'Examiner mes préférences' })
        .click();
      expect((await confirm()).status).toBe('completed');
      await mutate({ action: 'prepare', feedId });
      expect((await record(untouched.id)).message).toMatch(/^Merci à /);
      expect((await record(newDelivery.id)).message).toMatch(/^Merci à /);
      expect(
        (await facts()).deliveries.filter((d) => protectedIds.includes(d.id))
      ).toEqual(protectedBefore);
      expect(
        (await editorial()).profiles.filter((p) => p.feedId !== feedId)
      ).toEqual(otherProfiles);
      expect(await profile()).toMatchObject({
        preferences: [],
        observations: { neutral: 3 }
      });
    });

    await test.step('reader and expired session cannot save; mobile English review is accessible and no send occurs', async () => {
      const p = await profile();
      expect(
        (
          await reader.request.post(commandUrl, {
            headers,
            data: command('editorial.preferences', feedId, p.version, {
              preferences: ['neutral']
            })
          })
        ).status()
      ).toBe(403);
      await show(operator, 'Préférences');
      await programme(operator)
        .getByRole('checkbox', { name: 'Ton neutre' })
        .check();
      await programme(operator)
        .getByRole('button', { name: 'Examiner mes préférences' })
        .click();
      const before = await facts();
      const session = await (
        await operator.request.get('/api/admin/auth/current')
      ).json();
      await stack.pool.query(
        "UPDATE admin_identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
        [session.sessionId]
      );
      const response = operator.waitForResponse((r) =>
        r.url().endsWith(commandUrl)
      );
      await confirmation(operator)
        .getByRole('button', { name: 'Confirmer l’enregistrement' })
        .click();
      expect((await response).status()).toBe(401);
      await expect(operator.getByRole('alert')).toContainText(
        /session.*expir/i
      );
      expect(await facts()).toEqual(before);
      await owner
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
      await owner.setViewportSize({ width: 390, height: 844 });
      await show(owner, 'Preferences');
      await expect(
        programme(owner).getByRole('checkbox', { name: 'Neutral tone' })
      ).not.toBeChecked();
      expect(
        (
          await new AxeBuilder({ page: owner })
            .include('[data-og7="editorial-programme"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await owner
          .locator('dialog[open]')
          .evaluate((element) => element.scrollWidth <= element.clientWidth)
      ).toBe(true);
      await info.attach('editorial-preferences-mobile', {
        body: await owner.screenshot(),
        contentType: 'image/png'
      });
      const final = await state();
      expect(final.workerEnabled).toBe(false);
      expect(final.feeds.every((f) => f.paused)).toBe(true);
      expect(final.deliveries.every((d) => !d.publishedAt)).toBe(true);
      const counts = await effects();
      expect(counts.emails).toBe(baseline.emails);
      expect(counts.jobs).toBe(baseline.jobs);
      expect(errors).toEqual([]);
      const audit = (
        await stack.pool.query(
          "SELECT actor,action,entity_id,metadata FROM admin_audit_log WHERE action='editorial.preferences' ORDER BY created_at"
        )
      ).rows;
      expect(audit).toHaveLength(3);
      expect(audit.every((row) => row.entity_id === feedId && row.actor)).toBe(
        true
      );
      await info.attach('editorial-preferences-audit', {
        body: JSON.stringify(audit),
        contentType: 'application/json'
      });
    });
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
      await anonymous.dispose();
    } finally {
      await stack.stop();
    }
  }
});
