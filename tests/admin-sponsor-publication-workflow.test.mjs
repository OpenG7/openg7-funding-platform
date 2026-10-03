import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

// The root TypeScript build emits workspaces under dist/, without package-local builds.
const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core') {
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});
const { AdminSponsorPublicationWorkflow } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-publication-workflow.js');
workspaceHook.deregister();

const sponsor = (overrides = {}) => ({
  id: 'synthetic-sponsor',
  version: 'synthetic-dossier-v1',
  public_reference: 'SYNTHETIC-REFERENCE',
  public_name: 'Synthetic public name',
  sponsor_company_name: 'Synthetic company',
  amount: 100,
  payment_status: 'paid',
  public_display_consent: true,
  sponsor_review_status: 'approved',
  sponsorship_refund_status: 'not_requested',
  sponsor_public_slug: 'synthetic-company',
  sponsor_public_summary: 'Synthetic summary',
  sponsor_feed_target: null,
  sponsor_feed_channels: [],
  sponsor_feed_status: 'not_planned',
  sponsor_feed_public_url: null,
  sponsor_feed_notes: null,
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

const fixture = (record = sponsor(), locale = null) => {
  const catalog = locale
    ? JSON.parse(
        readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
      )
    : null;
  const state = {
    records: [record],
    selected: record.id,
    selectionRevision: 1,
    destroyed: false,
    loading: false,
    canManage: true,
    token: 'synthetic-token',
    action: null,
    paymentMessage: '',
    progress: {
      contributionId: record.id,
      website: {
        version: 'synthetic-site-v1',
        canPublish: true,
        visible: false,
        held: true,
        blockers: []
      }
    }
  };
  const calls = [];
  const confirmations = [];
  const transitions = [];
  const reloads = [];
  const errors = [];
  const translations = [];
  const ports = {
    admin: {
      async updateSponsorshipPublication(token, payload) {
        calls.push({ kind: 'publication', token, payload });
        return { updated: true };
      },
      async setSponsorshipWebsiteVisibility(token, payload) {
        calls.push({ kind: 'website', token, payload });
        return { updated: true };
      }
    },
    t(key, params = {}) {
      translations.push({ key, params });
      if (!catalog) return key;
      const value = key
        .split('.')
        .reduce((current, part) => current?.[part], catalog);
      assert.equal(
        typeof value,
        'string',
        `Missing ${locale} translation: ${key}`
      );
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
        String(params[name])
      );
    },
    adminToken: () => state.token,
    canActOn(candidate) {
      const current = state.records.find((item) => item.id === state.selected);
      return (
        !state.destroyed &&
        !state.loading &&
        state.canManage &&
        !state.action &&
        Boolean(state.token) &&
        current?.id === candidate.id &&
        current.version === candidate.version
      );
    },
    actionPending: () => Boolean(state.action),
    setActionState(action) {
      state.action = action;
      transitions.push(action);
    },
    async reloadSponsorships() {
      reloads.push(state.action);
    },
    messageFromError(error, fallback) {
      errors.push({ error, fallback });
      return `central-error:${error.status ?? 'unknown'}`;
    },
    selectionRevision: () => state.selectionRevision,
    isCurrentSelection: (id) => !state.destroyed && state.selected === id,
    sponsorships: () => state.records,
    progress: () => state.progress,
    paymentEligibilityMessage: () => state.paymentMessage,
    async confirm(message, detail) {
      confirmations.push({ message, detail });
      return true;
    }
  };
  const workflow = new AdminSponsorPublicationWorkflow(ports);
  workflow.reconcile([], state.records);
  const setField = (field, value, id = record.id) =>
    workflow.setPublicationField(id, field, { target: { value } });
  const leaveAndReturn = () => {
    state.selectionRevision += 2;
  };
  return {
    workflow,
    ports,
    state,
    calls,
    confirmations,
    transitions,
    reloads,
    errors,
    translations,
    setField,
    leaveAndReturn
  };
};

test('saving a publication sends the existing trimmed contract with the dossier version and shared lock', async () => {
  const f = fixture();
  f.setField('publicSlug', ' Équipe synthétique ');
  f.setField('publicSummary', '  Synthetic edited summary  ');
  f.setField('feedTarget', 'openg20');
  f.setField('feedStatus', 'drafted');
  f.setField('feedPublicUrl', '  https://example.test/synthetic  ');
  f.setField('feedNotes', '  Synthetic private note  ');
  f.workflow.setPublicationChannel(f.state.selected, 'linkedin', {
    target: { checked: true }
  });
  await f.workflow.savePublication(f.state.records[0]);
  assert.deepEqual(f.calls, [
    {
      kind: 'publication',
      token: 'synthetic-token',
      payload: {
        contributionId: 'synthetic-sponsor',
        expectedVersion: 'synthetic-dossier-v1',
        publicSlug: 'equipe-synthetique',
        publicSummary: 'Synthetic edited summary',
        feedTarget: 'openg20',
        feedChannels: ['linkedin'],
        feedStatus: 'drafted',
        feedPublicUrl: 'https://example.test/synthetic',
        feedNotes: 'Synthetic private note'
      }
    }
  ]);
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual(f.transitions, ['publication:synthetic-sponsor', null]);
  assert.deepEqual(f.reloads, ['publication:synthetic-sponsor']);
  assert.equal(
    f.workflow.publicationMessages()[f.state.selected],
    'admin.messages.publication_enregistree_'
  );
});

test('empty optional fields retain their undefined or null payload semantics', async () => {
  const f = fixture();
  for (const field of [
    'publicSlug',
    'publicSummary',
    'feedPublicUrl',
    'feedNotes'
  ])
    f.setField(field, '');
  await f.workflow.savePublication(f.state.records[0]);
  assert.deepEqual(f.calls[0].payload, {
    contributionId: 'synthetic-sponsor',
    expectedVersion: 'synthetic-dossier-v1',
    publicSlug: undefined,
    publicSummary: undefined,
    feedTarget: null,
    feedChannels: [],
    feedStatus: 'not_planned',
    feedPublicUrl: undefined,
    feedNotes: undefined
  });
});

test('unchanged fields and invalid or duplicate slugs are blocked locally', async (t) => {
  await t.test('unchanged', async () => {
    const f = fixture();
    assert.equal(f.workflow.publicationDirtyFor(f.state.records[0]), false);
    await f.workflow.savePublication(f.state.records[0]);
    assert.deepEqual(f.calls, []);
    assert.equal(
      f.workflow.publicationMessages()[f.state.selected],
      'admin.messages.aucune_modification_a_enregistrer'
    );
  });
  await t.test('invalid and duplicate', async () => {
    const f = fixture();
    const record = f.state.records[0];
    f.workflow.publicationDrafts.update((drafts) => ({
      ...drafts,
      [record.id]: { ...drafts[record.id], publicSlug: 'invalid--slug' }
    }));
    assert.equal(
      f.workflow.slugErrorFor(record),
      'admin.messages.utilisez_seulement_des_lettres_chiffres_et_tirets'
    );
    await f.workflow.savePublication(record);
    f.state.records.push(
      sponsor({
        id: 'synthetic-other',
        sponsor_public_slug: 'Équipe existante'
      })
    );
    f.setField('publicSlug', 'équipe existante');
    assert.equal(f.workflow.hasSlugError(record), true);
    assert.equal(
      f.workflow.slugErrorFor(record),
      'admin.messages.ce_slug_est_deja_utilise'
    );
    await f.workflow.savePublication(record);
    assert.deepEqual(f.calls, []);
    f.setField('publicSlug', 'synthetic-company');
    assert.equal(f.workflow.hasSlugError(record), false);
  });
});

test('publication and removal from published status require the matching explicit confirmation', async (t) => {
  for (const [from, to, key] of [
    ['drafted', 'published', 'admin.confirmation.publish'],
    ['published', 'hidden', 'admin.confirmation.cancelPublication'],
    ['published', 'drafted', 'admin.confirmation.cancelPublication']
  ]) {
    await t.test(`${from} to ${to}`, async () => {
      const f = fixture(sponsor({ sponsor_feed_status: from }));
      f.setField('feedStatus', to);
      await f.workflow.savePublication(f.state.records[0]);
      assert.deepEqual(f.confirmations, [
        { message: key, detail: 'SYNTHETIC-REFERENCE' }
      ]);
      assert.equal(f.calls[0].payload.feedStatus, to);
    });
  }
});

test('cancelling a publication confirmation preserves the complete draft and makes no request', async () => {
  const f = fixture();
  f.setField('feedStatus', 'published');
  f.setField('feedNotes', 'Synthetic retained note');
  f.ports.confirm = async () => false;
  const draft = f.workflow.publicationDraftFor(f.state.selected);
  await f.workflow.savePublication(f.state.records[0]);
  assert.equal(f.workflow.publicationDraftFor(f.state.selected), draft);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.transitions, []);
});

test('publication rechecks dossier, permission, global lock, edits, slug and selection after confirmation', async (t) => {
  const changes = {
    version: (f) => {
      f.state.records = [sponsor({ version: 'synthetic-dossier-v2' })];
    },
    permission: (f) => {
      f.state.canManage = false;
    },
    token: (f) => {
      f.state.token = '';
    },
    loading: (f) => {
      f.state.loading = true;
    },
    lock: (f) => {
      f.state.action = 'review:synthetic-sponsor';
    },
    draft: (f) => f.setField('publicSummary', 'Synthetic unconfirmed edit'),
    slug: (f) => {
      f.state.records.push(sponsor({ id: 'synthetic-other' }));
    },
    selection: (f) => {
      f.state.selected = 'synthetic-other';
    },
    returnToSelection: (f) => f.leaveAndReturn(),
    disposal: (f) => f.workflow.dispose(),
    payment: (f) => {
      f.state.records[0].payment_status = 'refunded';
    },
    refund: (f) => {
      f.state.records[0].sponsorship_refund_status = 'processing';
    }
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async () => {
      const f = fixture();
      const confirmation = deferred();
      f.setField('feedStatus', 'published');
      f.ports.confirm = () => confirmation.promise;
      const saving = f.workflow.savePublication(f.state.records[0]);
      change(f);
      confirmation.resolve(true);
      await saving;
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.transitions, []);
    });
  }
});

test('existing publication eligibility remains paid and not processing, without changing review or consent', async (t) => {
  for (const payment of ['pending', 'refunded', 'disputed', 'failed']) {
    await t.test(payment, async () => {
      const f = fixture(sponsor({ payment_status: payment }));
      f.setField('feedNotes', 'Synthetic edit');
      assert.equal(f.workflow.canSavePublication(f.state.records[0]), false);
      await f.workflow.savePublication(f.state.records[0]);
      assert.deepEqual(f.calls, []);
      assert.equal(
        f.workflow.publicationMessages()[f.state.selected],
        'admin.messages.publication_bloquee_le_paiement_n_est_pas_admissible'
      );
    });
  }
  for (const refund of [
    'not_requested',
    'requested',
    'completed',
    'failed',
    'processing'
  ]) {
    await t.test(refund, async () => {
      const f = fixture(
        sponsor({
          sponsorship_refund_status: refund,
          sponsor_review_status: 'pending_review',
          public_display_consent: false
        })
      );
      f.setField('feedNotes', 'Synthetic private edit');
      f.state.paymentMessage = 'synthetic eligibility explanation';
      await f.workflow.savePublication(f.state.records[0]);
      assert.equal(f.calls.length, refund === 'processing' ? 0 : 1);
      assert.equal(f.state.records[0].sponsor_review_status, 'pending_review');
      assert.equal(f.state.records[0].public_display_consent, false);
      if (refund === 'processing')
        assert.equal(
          f.workflow.publicationMessages()[f.state.selected],
          'synthetic eligibility explanation'
        );
    });
  }
});

test('global action lock prevents a second publication request while the first is pending', async () => {
  const f = fixture();
  const request = deferred();
  f.setField('feedNotes', 'Synthetic edit');
  f.ports.admin.updateSponsorshipPublication = async (...args) => {
    f.calls.push(args);
    return request.promise;
  };
  const saving = f.workflow.savePublication(f.state.records[0]);
  await f.workflow.savePublication(f.state.records[0]);
  assert.equal(f.calls.length, 1);
  request.resolve({ updated: true });
  await saving;
  assert.equal(f.state.action, null);
});

test('publication failures pass through central 401/409 handling and retain local drafts', async (t) => {
  for (const error of [
    new AdminDashboardRequestError(401),
    new AdminDashboardRequestError(409),
    new Error('Synthetic request failure')
  ]) {
    await t.test(String(error.status ?? 'network'), async () => {
      const f = fixture();
      f.setField('feedNotes', 'Synthetic retained note');
      const draft = f.workflow.publicationDraftFor(f.state.selected);
      f.ports.admin.updateSponsorshipPublication = async () => {
        throw error;
      };
      await f.workflow.savePublication(f.state.records[0]);
      assert.equal(f.errors[0].error, error);
      assert.equal(
        f.workflow.publicationMessages()[f.state.selected],
        `central-error:${error.status ?? 'unknown'}`
      );
      assert.equal(f.workflow.publicationDraftFor(f.state.selected), draft);
      assert.deepEqual(f.reloads, []);
      assert.equal(f.state.action, null);
    });
  }
});

test('late publication responses refresh confirmed facts and central errors without replacing messages', async (t) => {
  for (const change of ['leave', 'return', 'dispose']) {
    for (const result of ['success', 'error']) {
      await t.test(`${change} ${result}`, async () => {
        const f = fixture();
        const request = deferred();
        f.setField('feedNotes', 'Synthetic pending note');
        f.ports.admin.updateSponsorshipPublication = () => request.promise;
        const saving = f.workflow.savePublication(f.state.records[0]);
        if (change === 'leave') f.state.selected = 'synthetic-other';
        if (change === 'return') f.leaveAndReturn();
        if (change === 'dispose') f.workflow.dispose();
        if (result === 'success') request.resolve({ updated: true });
        else request.reject(new AdminDashboardRequestError(401));
        await saving;
        assert.equal(
          f.reloads.length,
          result === 'success' && change !== 'dispose' ? 1 : 0
        );
        assert.equal(
          f.errors.length,
          result === 'error' && change !== 'dispose' ? 1 : 0
        );
        assert.equal(
          f.workflow.publicationMessages()['synthetic-sponsor'],
          undefined
        );
        assert.equal(f.state.action, null);
      });
    }
  }
});

test('a selection change during publication refresh cannot publish a late success message', async () => {
  const f = fixture();
  const reload = deferred();
  const reloadStarted = deferred();
  f.setField('feedNotes', 'Synthetic pending edit');
  f.ports.reloadSponsorships = () => {
    reloadStarted.resolve();
    return reload.promise;
  };
  const saving = f.workflow.savePublication(f.state.records[0]);
  await reloadStarted.promise;
  f.leaveAndReturn();
  reload.resolve();
  await saving;
  assert.equal(
    f.workflow.publicationMessages()['synthetic-sponsor'],
    undefined
  );
  assert.equal(f.state.action, null);
});

test('website visibility uses its distinct version, explicit publish/hide confirmation and server refresh', async (t) => {
  for (const visible of [true, false]) {
    await t.test(visible ? 'publish' : 'hide', async () => {
      const f = fixture();
      await f.workflow.changeWebsiteVisibility(f.state.records[0], visible);
      assert.deepEqual(f.confirmations, [
        {
          message: `admin.dossier.publicationBridge.site.${visible ? 'confirmPublish' : 'confirmHide'}`,
          detail: 'Synthetic company'
        }
      ]);
      assert.deepEqual(f.calls, [
        {
          kind: 'website',
          token: 'synthetic-token',
          payload: {
            contributionId: 'synthetic-sponsor',
            expectedVersion: 'synthetic-site-v1',
            visible,
            confirmed: true
          }
        }
      ]);
      assert.deepEqual(f.transitions, ['website:synthetic-sponsor', null]);
      assert.deepEqual(f.reloads, ['website:synthetic-sponsor']);
      assert.equal(
        f.workflow.websiteMessages()['synthetic-sponsor'],
        'admin.dossier.publicationBridge.site.saved'
      );
    });
  }
});

test('website publishing respects server consent and eligibility blockers while hiding remains possible', async (t) => {
  for (const blocker of [
    'public_consent_missing',
    'payment_not_paid',
    'review_not_approved',
    'refund_processing'
  ]) {
    await t.test(blocker, async () => {
      const f = fixture();
      f.state.progress.website.canPublish = false;
      f.state.progress.website.blockers = [blocker];
      await f.workflow.changeWebsiteVisibility(f.state.records[0], true);
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.confirmations, []);
      await f.workflow.changeWebsiteVisibility(f.state.records[0], false);
      assert.equal(f.calls[0].payload.visible, false);
    });
  }
});

test('website confirmation cancellation and absent or unrelated progress cannot create a request', async (t) => {
  for (const kind of ['cancel', 'absent', 'unrelated', 'olderServer']) {
    await t.test(kind, async () => {
      const f = fixture();
      if (kind === 'cancel') f.ports.confirm = async () => false;
      if (kind === 'absent') f.state.progress = null;
      if (kind === 'unrelated')
        f.state.progress.contributionId = 'synthetic-other';
      if (kind === 'olderServer') delete f.state.progress.website;
      await f.workflow.changeWebsiteVisibility(f.state.records[0], true);
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.transitions, []);
    });
  }
});

test('website action rechecks site and dossier versions, consent, permissions and selection after confirmation', async (t) => {
  const changes = {
    siteVersion: (f) => {
      f.state.progress.website = {
        ...f.state.progress.website,
        version: 'synthetic-site-v2'
      };
    },
    dossierVersion: (f) => {
      f.state.records = [sponsor({ version: 'synthetic-dossier-v2' })];
    },
    consent: (f) => {
      f.state.progress.website = {
        ...f.state.progress.website,
        canPublish: false
      };
    },
    unrelated: (f) => {
      f.state.progress.contributionId = 'synthetic-other';
    },
    absent: (f) => {
      f.state.progress = null;
    },
    permission: (f) => {
      f.state.canManage = false;
    },
    lock: (f) => {
      f.state.action = 'review:synthetic-sponsor';
    },
    selection: (f) => {
      f.state.selected = 'synthetic-other';
    },
    returnToSelection: (f) => f.leaveAndReturn(),
    disposal: (f) => f.workflow.dispose()
  };
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async () => {
      const f = fixture();
      const confirmation = deferred();
      f.ports.confirm = () => confirmation.promise;
      const saving = f.workflow.changeWebsiteVisibility(
        f.state.records[0],
        true
      );
      change(f);
      confirmation.resolve(true);
      await saving;
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.transitions, []);
    });
  }
});

test('website 401/409 errors retain central handling and existing conflict-specific messages', async (t) => {
  for (const status of [401, 409, 500]) {
    await t.test(String(status), async () => {
      const f = fixture();
      const error = new AdminDashboardRequestError(status);
      f.ports.admin.setSponsorshipWebsiteVisibility = async () => {
        throw error;
      };
      await f.workflow.changeWebsiteVisibility(f.state.records[0], true);
      assert.deepEqual(f.errors, [{ error, fallback: '' }]);
      assert.equal(
        f.workflow.websiteMessages()['synthetic-sponsor'],
        status === 409
          ? 'admin.dossier.conflict'
          : 'admin.dossier.publicationBridge.site.failed'
      );
      assert.deepEqual(f.reloads, []);
      assert.equal(f.state.action, null);
    });
  }
});

test('late website responses and errors stay isolated after leaving and returning', async (t) => {
  for (const change of ['leave', 'return', 'dispose']) {
    for (const result of ['success', 'error']) {
      await t.test(`${change} ${result}`, async () => {
        const f = fixture();
        const request = deferred();
        f.ports.admin.setSponsorshipWebsiteVisibility = () => request.promise;
        const saving = f.workflow.changeWebsiteVisibility(
          f.state.records[0],
          true
        );
        await Promise.resolve();
        if (change === 'leave') f.state.selected = 'synthetic-other';
        if (change === 'return') f.leaveAndReturn();
        if (change === 'dispose') f.workflow.dispose();
        if (result === 'success') request.resolve({ updated: true });
        else request.reject(new AdminDashboardRequestError(409));
        await saving;
        assert.deepEqual(f.reloads, []);
        assert.deepEqual(f.errors, []);
        assert.equal(
          f.workflow.websiteMessages()['synthetic-sponsor'],
          undefined
        );
        assert.equal(f.state.action, null);
      });
    }
  }
});

test('late completion removes only its captured pending message and preserves newer messages', async (t) => {
  for (const kind of ['publication', 'website']) {
    for (const result of ['success', 'error']) {
      await t.test(`${kind} ${result}`, async () => {
        const f = fixture();
        const request = deferred();
        const messages =
          kind === 'publication'
            ? f.workflow.publicationMessages
            : f.workflow.websiteMessages;
        f.setField('feedNotes', 'Synthetic local edit');
        f.ports.admin[
          kind === 'publication'
            ? 'updateSponsorshipPublication'
            : 'setSponsorshipWebsiteVisibility'
        ] = () => request.promise;
        const saving =
          kind === 'publication'
            ? f.workflow.savePublication(f.state.records[0])
            : f.workflow.changeWebsiteVisibility(f.state.records[0], true);
        await Promise.resolve();
        messages.update((current) => ({
          ...current,
          'synthetic-sponsor': 'Synthetic newer message',
          'synthetic-other': 'Synthetic other message'
        }));
        f.leaveAndReturn();
        if (result === 'success') request.resolve({ updated: true });
        else request.reject(new AdminDashboardRequestError(409));
        await saving;
        assert.deepEqual(messages(), {
          'synthetic-sponsor': 'Synthetic newer message',
          'synthetic-other': 'Synthetic other message'
        });
        assert.equal(f.state.action, null);
      });
    }
  }
});

test('late website refresh removes its pending message after a leave-and-return race', async () => {
  const f = fixture();
  const reload = deferred();
  const reloadStarted = deferred();
  f.ports.reloadSponsorships = () => {
    reloadStarted.resolve();
    return reload.promise;
  };
  const saving = f.workflow.changeWebsiteVisibility(f.state.records[0], true);
  await reloadStarted.promise;
  f.leaveAndReturn();
  reload.resolve();
  await saving;
  assert.equal(f.workflow.websiteMessages()['synthetic-sponsor'], undefined);
  assert.equal(f.state.action, null);
});

test('reconciliation preserves each edited field and refreshes all untouched server values', () => {
  const f = fixture();
  const before = f.state.records[0];
  f.setField('publicSummary', 'Synthetic local summary');
  f.setField('feedNotes', 'Synthetic local notes');
  f.workflow.setPublicationChannel(before.id, 'facebook', {
    target: { checked: true }
  });
  const next = sponsor({
    version: 'synthetic-dossier-v2',
    sponsor_public_slug: 'synthetic-new-slug',
    sponsor_public_summary: 'Synthetic server summary',
    sponsor_feed_target: 'openg20',
    sponsor_feed_channels: ['linkedin'],
    sponsor_feed_status: 'planned',
    sponsor_feed_public_url: 'https://example.test/refreshed',
    sponsor_feed_notes: 'Synthetic server notes'
  });
  f.workflow.reconcile([before], [next], true);
  assert.deepEqual(f.workflow.publicationDraftFor(before.id), {
    publicSlug: 'synthetic-new-slug',
    publicSummary: 'Synthetic local summary',
    feedTarget: 'openg20',
    facebook: true,
    linkedin: true,
    feedStatus: 'planned',
    feedPublicUrl: 'https://example.test/refreshed',
    feedNotes: 'Synthetic local notes'
  });
});

test('reconciliation compares generated slug and promised channel defaults as form values', () => {
  const before = sponsor({
    sponsor_public_slug: null,
    public_name: 'Équipe synthétique',
    amount: 250
  });
  const f = fixture(before);
  assert.equal(
    f.workflow.publicationDraftFor(before.id).publicSlug,
    'equipe-synthetique'
  );
  assert.equal(f.workflow.publicationDraftFor(before.id).facebook, true);
  assert.equal(f.workflow.publicationDirtyFor(before), true);
  const next = sponsor({
    sponsor_public_slug: null,
    public_name: 'Équipe renouvelée',
    amount: 100
  });
  f.workflow.reconcile([before], [next], true);
  assert.equal(
    f.workflow.publicationDraftFor(before.id).publicSlug,
    'equipe-renouvelee'
  );
  assert.equal(f.workflow.publicationDraftFor(before.id).facebook, false);
  f.setField('publicSlug', 'Synthetic local slug');
  f.workflow.setPublicationChannel(before.id, 'linkedin', {
    target: { checked: true }
  });
  const refreshed = sponsor({
    sponsor_public_slug: 'synthetic-server-slug',
    amount: 500
  });
  f.workflow.reconcile([next], [refreshed], true);
  assert.equal(
    f.workflow.publicationDraftFor(before.id).publicSlug,
    'synthetic-local-slug'
  );
  assert.equal(f.workflow.publicationDraftFor(before.id).facebook, true);
  assert.equal(f.workflow.publicationDraftFor(before.id).linkedin, true);
});

test('normal reload resets drafts and removes missing sponsors; preservation needs a previous record', () => {
  const f = fixture();
  f.setField('feedNotes', 'Synthetic local edit');
  f.setField('feedNotes', 'Synthetic stale draft', 'synthetic-removed');
  f.workflow.reconcile([], [f.state.records[0]], true);
  assert.equal(f.workflow.publicationDraftFor(f.state.selected).feedNotes, '');
  assert.equal(f.workflow.publicationDrafts()['synthetic-removed'], undefined);
  f.setField('feedNotes', 'Synthetic second edit');
  f.workflow.reconcile(f.state.records, f.state.records, false);
  assert.equal(f.workflow.publicationDraftFor(f.state.selected).feedNotes, '');
  assert.deepEqual(f.calls, []);
});

test('draft fallback, nullable events and sponsor-isolated edits preserve the existing defaults', () => {
  const f = fixture();
  const existing = f.workflow.publicationDraftFor(f.state.selected);
  f.workflow.setPublicationField('synthetic-other', 'publicSlug', {
    target: { value: 'ÉCOLE / Synthétique___7' }
  });
  f.workflow.setPublicationField('synthetic-other', 'publicSummary', {
    target: null
  });
  f.workflow.setPublicationChannel('synthetic-other', 'linkedin', {
    target: { checked: true }
  });
  assert.deepEqual(f.workflow.publicationDraftFor('synthetic-other'), {
    publicSlug: 'ecole-synthetique-7',
    publicSummary: '',
    feedTarget: '',
    facebook: false,
    linkedin: true,
    feedStatus: 'not_planned',
    feedPublicUrl: '',
    feedNotes: ''
  });
  assert.equal(f.workflow.publicationDraftFor(f.state.selected), existing);
  assert.equal(
    f.workflow.publicationDraftFor('synthetic-absent').feedStatus,
    'not_planned'
  );
});

test('promised channels use existing benefit thresholds and cannot be unchecked', () => {
  for (const [amount, channels] of [
    [100, []],
    [250, ['facebook']],
    [500, ['facebook', 'linkedin']]
  ]) {
    const f = fixture(sponsor({ amount }));
    assert.deepEqual(
      f.workflow.promisedFeedChannelsFor(f.state.records[0]),
      channels
    );
    for (const channel of ['facebook', 'linkedin']) {
      f.workflow.setPublicationChannel(f.state.selected, channel, {
        target: { checked: false }
      });
      assert.equal(
        f.workflow.publicationDraftFor(f.state.selected)[channel],
        channels.includes(channel)
      );
    }
  }
});

test('publication state labels retain message, payment, slug, dirty and saved precedence', () => {
  const f = fixture();
  const record = f.state.records[0];
  assert.equal(
    f.workflow.publicationStateLabel(record),
    'admin.messages.publication_enregistree'
  );
  f.setField('feedNotes', 'Synthetic edit');
  assert.equal(
    f.workflow.publicationStateLabel(record),
    'admin.messages.modifications_non_enregistrees'
  );
  f.state.records.push(sponsor({ id: 'synthetic-other' }));
  assert.equal(
    f.workflow.publicationStateLabel(record),
    'admin.messages.ce_slug_est_deja_utilise'
  );
  f.state.paymentMessage = 'synthetic eligibility message';
  assert.equal(
    f.workflow.publicationStateLabel(record),
    'synthetic eligibility message'
  );
  f.workflow.publicationMessages.set({
    [record.id]: 'synthetic workflow message'
  });
  assert.equal(
    f.workflow.publicationStateLabel(record),
    'synthetic workflow message'
  );
});

for (const locale of ['fr-CA', 'en']) {
  test(`publication, visibility and channel messages resolve existing translations in ${locale}`, async () => {
    const f = fixture(sponsor({ amount: 500 }), locale);
    assert.match(
      f.workflow.draftChannelsLabel(f.state.selected),
      /Facebook \/ LinkedIn/
    );
    assert.ok(f.workflow.publicationStateLabel(f.state.records[0]));
    f.setField('feedStatus', 'published');
    await f.workflow.savePublication(f.state.records[0]);
    await f.workflow.changeWebsiteVisibility(f.state.records[0], true);
    assert.equal(f.confirmations.length, 2);
    for (const confirmation of f.confirmations)
      assert.doesNotMatch(confirmation.message, /^admin\./);
    assert.doesNotMatch(
      f.workflow.publicationMessages()[f.state.selected],
      /^admin\./
    );
    assert.doesNotMatch(
      f.workflow.websiteMessages()[f.state.selected],
      /^admin\./
    );
    const empty = fixture(sponsor(), locale);
    assert.doesNotMatch(
      empty.workflow.draftChannelsLabel(empty.state.selected),
      /^admin\./
    );
  });
}
