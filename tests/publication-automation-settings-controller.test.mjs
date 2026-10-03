import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { signal } from '@angular/core';

import { PublicationAutomationSettingsController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/publication-automation-settings.controller.js';

const feed = (overrides = {}) => ({
  id: 'openg7:facebook',
  paused: true,
  autoPrepare: true,
  weekdays: [1, 3, 5],
  localTime: '10:00',
  timezone: 'America/Toronto',
  capacity: 3,
  horizonDays: 14,
  mode: 'mock',
  configured: true,
  accountId: 'synthetic-destination',
  connection: 'ready',
  expiresAt: null,
  ...overrides
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const fixture = (locale = 'fr-CA') => {
  const catalog = JSON.parse(
    readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
  );
  const ports = {
    state: signal({ feeds: [feed()], workerEnabled: false, workerVersion: 7 }),
    busy: signal(false),
    canManageWorker: signal(true),
    error: signal('synthetic-old-error'),
    notice: signal('synthetic-old-notice'),
    i18n: {
      currentLanguage: signal(locale),
      t: (key) => {
        const text = key
          .split('.')
          .reduce((current, part) => current?.[part], catalog);
        assert.equal(
          typeof text,
          'string',
          `Missing ${locale} translation: ${key}`
        );
        return text;
      }
    },
    confirmation: {
      confirm: async (message, target) => {
        confirmations.push({ message, target });
        return true;
      }
    },
    commands: {
      run: async (command) => {
        commands.push(command);
      }
    },
    clearFeedback: () => {
      ports.error.set('');
      ports.notice.set('');
    }
  };
  const commands = [];
  const confirmations = [];
  const controller = new PublicationAutomationSettingsController(ports);
  return { controller, ports, commands, confirmations };
};

test('configuration drafts clone recurrence without changing the saved destination', () => {
  const f = fixture();
  const saved = f.ports.state().feeds[0];
  f.controller.configure(saved);
  assert.equal(f.ports.error(), '');
  assert.equal(f.ports.notice(), '');
  assert.notEqual(f.controller.settings(), saved);
  assert.notEqual(f.controller.settings().weekdays, saved.weekdays);
  assert.equal(f.controller.settingsDirty(), false);
  f.controller.toggleDay(3);
  f.controller.toggleDay(2);
  assert.deepEqual(saved.weekdays, [1, 3, 5]);
  assert.deepEqual(f.controller.settings().weekdays, [1, 5, 2]);
  assert.equal(f.controller.settingsDirty(), true);
  assert.deepEqual(f.commands, []);
});

for (const [field, changed] of [
  ['paused', false],
  ['autoPrepare', false],
  ['localTime', '14:30'],
  ['timezone', 'Europe/Paris'],
  ['capacity', 4],
  ['horizonDays', 28],
  ['weekdays', [1, 2, 3]]
]) {
  test(`unsaved ${field} blocks preparation without blocking a connection check`, () => {
    const f = fixture();
    f.controller.configure(f.ports.state().feeds[0]);
    f.controller.settings()[field] = changed;
    assert.equal(f.controller.settingsDirty(), true);
    f.controller.prepare('openg7:facebook');
    f.controller.check('openg7:facebook');
    assert.deepEqual(f.commands, [
      { action: 'check', feedId: 'openg7:facebook' }
    ]);
  });
}

test('reordering equivalent recurrence days keeps the saved configuration clean', () => {
  const f = fixture();
  f.controller.configure(f.ports.state().feeds[0]);
  f.controller.settings().weekdays = [5, 1, 3];
  assert.equal(f.controller.settingsDirty(), false);
  f.controller.prepare('openg7:facebook');
  assert.deepEqual(f.commands, [
    { action: 'prepare', feedId: 'openg7:facebook' }
  ]);
});

test('save sends a snapshot and keeps local edits until authoritative reread reconciliation', () => {
  const f = fixture();
  f.controller.configure(f.ports.state().feeds[0]);
  const draft = f.controller.settings();
  draft.timezone = 'Europe/Paris';
  draft.capacity = 5;
  f.controller.saveSettings();
  assert.deepEqual(f.commands, [{ action: 'settings', settings: draft }]);
  assert.notEqual(f.commands[0].settings, draft);
  assert.notEqual(f.commands[0].settings.weekdays, draft.weekdays);
  assert.equal(f.controller.settings(), draft);
  assert.equal(f.controller.settingsDirty(), true);
  assert.equal(f.ports.state().feeds[0].timezone, 'America/Toronto');

  const confirmed = feed({ timezone: 'Europe/Paris', capacity: 5 });
  f.ports.state.update((state) => ({ ...state, feeds: [confirmed] }));
  f.controller.acceptConfirmedSettings(f.commands[0]);
  assert.deepEqual(f.controller.settings(), confirmed);
  assert.notEqual(f.controller.settings(), confirmed);
  assert.notEqual(f.controller.settings().weekdays, confirmed.weekdays);
  assert.equal(f.controller.settingsDirty(), false);
});

test('failed command or reread retains the same unsaved draft and feedback', () => {
  const f = fixture();
  f.controller.configure(f.ports.state().feeds[0]);
  f.controller.settings().localTime = '12:30';
  f.controller.saveSettings();
  const draft = f.controller.settings();
  f.ports.error.set('admin.publicationAutomation.errors.generic');
  // The page does not call acceptConfirmedSettings when either server step fails.
  assert.equal(f.controller.settings(), draft);
  assert.equal(f.controller.settingsDirty(), true);
  assert.equal(f.ports.state().feeds[0].localTime, '10:00');
  assert.equal(
    f.controller.error(),
    'admin.publicationAutomation.errors.generic'
  );
});

test('confirmation from another feed, a closed drawer or a non-settings command preserves current drafts', () => {
  const f = fixture();
  f.controller.configure(f.ports.state().feeds[0]);
  const draft = f.controller.settings();
  draft.capacity = 8;
  f.controller.acceptConfirmedSettings({ action: 'check', feedId: draft.id });
  f.controller.acceptConfirmedSettings({
    action: 'settings',
    settings: feed({ id: 'openg20:linkedin' })
  });
  assert.equal(f.controller.settings(), draft);
  assert.equal(draft.capacity, 8);
  f.controller.closeSettings();
  f.controller.acceptConfirmedSettings({
    action: 'settings',
    settings: feed()
  });
  assert.equal(f.controller.settings(), null);
});

test('destination pause preserves recurrence and uses the existing settings payload', () => {
  const f = fixture();
  const saved = f.ports.state().feeds[0];
  f.controller.pause(saved);
  assert.deepEqual(f.commands, [
    { action: 'settings', settings: { ...saved, paused: false } }
  ]);
  assert.equal(saved.paused, true);
  assert.notEqual(f.commands[0].settings.weekdays, saved.weekdays);
  assert.equal(f.controller.settings(), null);
});

test('pending commands block save, preparation, connection checks, pause and drawer edits', () => {
  const f = fixture();
  const saved = f.ports.state().feeds[0];
  f.controller.configure(saved);
  const draft = f.controller.settings();
  f.ports.busy.set(true);
  f.controller.saveSettings();
  f.controller.prepare(saved.id);
  f.controller.check(saved.id);
  f.controller.pause(saved);
  f.controller.configure(feed({ id: 'openg20:linkedin' }));
  f.controller.closeSettings();
  f.controller.toggleDay(2);
  assert.equal(f.controller.settings(), draft);
  assert.deepEqual(draft.weekdays, [1, 3, 5]);
  assert.deepEqual(f.commands, []);
});

for (const locale of ['fr-CA', 'en']) {
  test(`worker activation confirms its exact version and target in ${locale}`, async () => {
    const f = fixture(locale);
    await f.controller.toggleWorker();
    assert.equal(f.confirmations.length, 1);
    assert.equal(
      f.confirmations[0].message,
      f.ports.i18n.t('admin.publicationAutomation.workerConfirm')
    );
    assert.equal(
      f.confirmations[0].target,
      f.ports.i18n.t('admin.publicationAutomation.workerTitle')
    );
    assert.deepEqual(f.commands, [
      {
        action: 'worker',
        enabled: true,
        version: 7,
        confirmation: 'enable-worker'
      }
    ]);
    assert.equal(f.ports.state().workerEnabled, false);
    assert.equal(f.controller.workerChanging(), false);
  });
}

test('worker stop carries disable-worker without asking the activation confirmation', async () => {
  const f = fixture();
  f.ports.state.update((state) => ({
    ...state,
    workerEnabled: true,
    workerVersion: 8
  }));
  await f.controller.toggleWorker();
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual(f.commands, [
    {
      action: 'worker',
      enabled: false,
      version: 8,
      confirmation: 'disable-worker'
    }
  ]);
  assert.equal(f.ports.state().workerEnabled, true);
});

test('cancelled activation and missing state, owner permission or busy state send no command', async () => {
  const f = fixture();
  f.ports.confirmation.confirm = async () => false;
  await f.controller.toggleWorker();
  assert.equal(f.controller.workerChanging(), false);
  f.ports.canManageWorker.set(false);
  await f.controller.toggleWorker();
  f.ports.canManageWorker.set(true);
  f.ports.busy.set(true);
  await f.controller.toggleWorker();
  f.ports.busy.set(false);
  f.ports.state.set(null);
  await f.controller.toggleWorker();
  assert.deepEqual(f.commands, []);
});

test('delayed confirmation locks repeated activation and rechecks owner authority', async () => {
  const f = fixture();
  const confirmation = deferred();
  f.ports.confirmation.confirm = () => confirmation.promise;
  const pending = f.controller.toggleWorker();
  assert.equal(f.controller.workerChanging(), true);
  await f.controller.toggleWorker();
  f.ports.canManageWorker.set(false);
  confirmation.resolve(true);
  await pending;
  assert.deepEqual(f.commands, []);
  assert.equal(f.controller.workerChanging(), false);
});

test('a replaced server state invalidates a worker activation still awaiting confirmation', async () => {
  const f = fixture();
  const confirmation = deferred();
  f.ports.confirmation.confirm = () => confirmation.promise;
  const pending = f.controller.toggleWorker();
  f.ports.state.update((state) => ({ ...state, workerVersion: 8 }));
  confirmation.resolve(true);
  await pending;
  assert.deepEqual(f.commands, []);
  assert.equal(f.controller.workerChanging(), false);
});

test('disposing the controller invalidates pending and subsequent worker decisions', async () => {
  const f = fixture();
  const confirmation = deferred();
  f.ports.confirmation.confirm = () => confirmation.promise;
  const pending = f.controller.toggleWorker();
  f.controller.dispose();
  confirmation.resolve(true);
  await pending;
  await f.controller.toggleWorker();
  assert.deepEqual(f.commands, []);
  assert.equal(f.controller.workerChanging(), false);
});

test('worker stays locked until server command and reread finish without optimistic state changes', async () => {
  const f = fixture();
  f.ports.state.update((state) => ({ ...state, workerEnabled: true }));
  const response = deferred();
  f.ports.commands.run = (command) => {
    f.commands.push(command);
    return response.promise;
  };
  const pending = f.controller.toggleWorker();
  assert.equal(f.controller.workerChanging(), true);
  assert.equal(f.ports.state().workerEnabled, true);
  await f.controller.toggleWorker();
  assert.equal(f.commands.length, 1);
  response.resolve();
  await pending;
  assert.equal(f.controller.workerChanging(), false);
});

test('unexpected command errors release worker lock and never replay the decision', async () => {
  const f = fixture();
  f.ports.state.update((state) => ({ ...state, workerEnabled: true }));
  f.ports.commands.run = async (command) => {
    f.commands.push(command);
    throw new Error('SYNTHETIC_UNCERTAIN_RESULT');
  };
  await assert.rejects(
    f.controller.toggleWorker(),
    /SYNTHETIC_UNCERTAIN_RESULT/
  );
  assert.equal(f.controller.workerChanging(), false);
  assert.equal(f.commands.length, 1);
  assert.equal(f.ports.state().workerEnabled, true);
});

test('date labels use the current locale and tolerate unavailable dates without browser access', () => {
  const f = fixture();
  const date = '2026-10-03T15:00:00.000Z';
  assert.equal(
    f.controller.dateLabel(date),
    new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(date))
  );
  f.ports.i18n.currentLanguage.set('en');
  assert.equal(
    f.controller.dateLabel(date),
    new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(date))
  );
  assert.equal(f.controller.dateLabel('synthetic-unavailable-date'), '');
  assert.deepEqual(f.commands, []);
});

test('settings surface preserves the shared drawer, translated controls, hooks and responsive focus styles', () => {
  const base =
    'apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/';
  const component = readFileSync(
    base + 'admin-publication-automation-settings.component.ts',
    'utf8'
  );
  const template = readFileSync(
    base + 'admin-publication-automation-settings.component.html',
    'utf8'
  );
  const style = readFileSync(
    base + 'admin-publication-automation-settings.component.css',
    'utf8'
  );
  assert.match(component, /ChangeDetectionStrategy\.OnPush/);
  assert.match(
    component,
    /input\.required<PublicationAutomationSettingsController>/
  );
  assert.match(component, /AdminDrawerComponent/);
  assert.match(template, /data-og7="publication-worker-toggle"/);
  assert.match(template, /data-og7="publication-feed-settings"/);
  assert.match(template, /data-og7="publication-settings-editor"/);
  assert.match(template, /role="switch"/);
  assert.match(template, /\[attr\.aria-checked\]="s\.workerEnabled"/);
  assert.match(template, /\[disabled\]="!c\.canManageWorker\(\)"/);
  assert.match(template, /\(closed\)="c\.closeSettings\(\)"/);
  assert.match(template, /c\.check\(s\.id\)/);
  assert.match(template, /c\.prepare\(s\.id\)/);
  assert.match(style, /settings-day input:focus-visible \+ span/);
  assert.match(style, /@media \(max-width: 520px\)/);
  for (const locale of ['fr-CA', 'en']) {
    const catalog = JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    );
    for (const match of template.matchAll(
      /'(admin\.publicationAutomation\.[A-Za-z.]+)'/g
    )) {
      const value = match[1]
        .replace(/\.$/, '')
        .split('.')
        .reduce((current, part) => current?.[part], catalog);
      assert.ok(value != null, `Missing ${locale} translation: ${match[1]}`);
    }
  }
});
