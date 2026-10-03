import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminSponsorRefundWorkflow } from '../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-refund-workflow.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const sponsor = (overrides = {}) => ({
  id: 'synthetic-sponsor',
  version: 'synthetic-version-1',
  public_reference: 'SYNTHETIC-REFERENCE',
  sponsor_company_name: 'Synthetic company',
  public_name: 'Synthetic public name',
  sponsor_contact_email: 'synthetic-sponsor@example.test',
  amount: 250,
  currency: 'CAD',
  payment_status: 'paid',
  sponsorship_refund_status: 'not_requested',
  sponsorship_refund_id: null,
  ...overrides
});

const refundResult = (overrides = {}) => ({
  refunded: true,
  refundId: 'synthetic-stripe-refund',
  refundStatus: 'succeeded',
  refundWorkflowStatus: 'completed',
  refundReason: 'requested_by_customer',
  fullRefund: true,
  amount: 250,
  currency: 'CAD',
  contributionId: 'synthetic-sponsor',
  paymentStatusUpdated: true,
  sponsorship: null,
  creditNote: { credit_note_number: 'SYNTHETIC-CREDIT-1' },
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

const fixture = (record = sponsor()) => {
  const state = {
    record,
    owner: true,
    token: 'synthetic-token',
    destroyed: false,
    loading: false,
    action: null
  };
  const calls = [];
  const messages = [];
  const translations = [];
  const errors = [];
  const pulses = [];
  const transitions = [];
  const reloads = [];
  const ports = {
    admin: {
      async refundSponsorship(token, payload) {
        calls.push({ token, payload });
        return refundResult();
      }
    },
    adminToken: () => state.token,
    canActOn: (candidate) =>
      !state.destroyed &&
      !state.loading &&
      !state.action &&
      Boolean(state.token) &&
      candidate.id === state.record?.id &&
      candidate.version === state.record?.version,
    actionPending: () => Boolean(state.action),
    setActionState: (action) => {
      state.action = action;
      transitions.push(action);
    },
    async reloadSponsorships() {
      reloads.push(state.action);
    },
    messageFromError: (error, fallback) => {
      errors.push({ error, fallback });
      return `central-error:${error.status ?? 'unknown'}`;
    },
    canUseOwnerActions: () => state.owner,
    setReviewMessage: (id, message, autoHide) =>
      messages.push({ id, message, autoHide }),
    pulseSelection: (id) => pulses.push(id),
    formatAmount: (amount, currency) => `${amount.toFixed(2)} ${currency}`,
    formatMoney: (record) => `${record.amount.toFixed(2)} ${record.currency}`,
    refundWorkflowStatusLabel: (status) => `workflow:${status}`,
    stripeRefundReasonLabel: (reason) => `reason:${reason}`,
    t: (key, params) => {
      translations.push({ key, params });
      return params ? `${key}:${JSON.stringify(params)}` : key;
    }
  };
  const workflow = new AdminSponsorRefundWorkflow(ports);
  const setField = (field, value, id = record.id) =>
    workflow.setRefundDraftField(id, field, { target: { value } });
  const ready = () => {
    workflow.openRefundPanel(record);
    setField('confirmationText', workflow.refundConfirmationText(record));
  };
  return {
    workflow,
    ports,
    state,
    calls,
    messages,
    translations,
    errors,
    pulses,
    transitions,
    reloads,
    setField,
    ready
  };
};

test('opening prepares a local draft and keeps edits through cancellation and reopening', () => {
  const f = fixture();
  const record = f.state.record;
  assert.equal(f.workflow.activeRefundId(), null);
  assert.deepEqual(f.workflow.refundDrafts(), {});
  assert.equal(f.workflow.openRefundPanel(record), true);
  const draft = f.workflow.refundDraftFor(record);
  assert.equal(draft.refundAmount, '250.00');
  assert.equal(draft.refundReason, 'requested_by_customer');
  assert.equal(draft.notifySponsor, true);
  assert.equal(draft.recipientEmail, record.sponsor_contact_email);
  assert.match(draft.sponsorMessage, /Synthetic company/);
  assert.equal(f.workflow.isRefundPanelOpen(record), true);
  assert.match(f.messages.at(-1).message, /SYNTHETIC-REFERENCE/);
  f.setField('refundNote', 'Synthetic retained note');
  f.setField('refundAmount', '125,50');
  assert.equal(f.workflow.closeRefundPanel(), true);
  assert.equal(f.workflow.isRefundPanelOpen(record), false);
  assert.equal(f.workflow.openRefundPanel(record), true);
  assert.equal(
    f.workflow.refundDraftFor(record).refundNote,
    'Synthetic retained note'
  );
  assert.equal(f.workflow.refundAmountFor(record), 125.5);
  assert.deepEqual(f.calls, []);
});

test('default draft handles absent contact, company and public reference without side effects', () => {
  const record = sponsor({
    public_reference: null,
    sponsor_company_name: null,
    public_name: null,
    sponsor_contact_email: null
  });
  const f = fixture(record);
  const draft = f.workflow.refundDraftFor(record);
  assert.equal(f.workflow.refundConfirmationText(record), record.id);
  assert.equal(draft.notifySponsor, false);
  assert.equal(draft.recipientEmail, '');
  assert.match(draft.sponsorMessage, /votre organisation/);
  assert.deepEqual(f.workflow.refundDrafts(), {});
  f.ready();
  assert.equal(f.workflow.canConfirmRefund(record), true);
});

test('draft event setters isolate sponsors and create a complete empty draft when absent', () => {
  const f = fixture();
  f.ready();
  const initialDraft = f.workflow.refundDraftFor(f.state.record);
  f.setField('refundNote', 'Synthetic second note', 'synthetic-other-sponsor');
  f.workflow.setRefundDraftReason('synthetic-other-sponsor', {
    target: { value: 'duplicate' }
  });
  f.workflow.setRefundDraftBoolean('synthetic-other-sponsor', 'notifySponsor', {
    target: { checked: true }
  });
  assert.deepEqual(f.workflow.refundDrafts()['synthetic-other-sponsor'], {
    confirmationText: '',
    refundAmount: '',
    refundReason: 'duplicate',
    notifySponsor: true,
    recipientEmail: '',
    sponsorMessage: '',
    refundNote: 'Synthetic second note'
  });
  assert.equal(f.workflow.refundDraftFor(f.state.record), initialDraft);
});

test('amount validation preserves decimal comma, precision, bounds and full refund classification', () => {
  const f = fixture();
  const record = f.state.record;
  f.ready();
  for (const value of [
    '',
    '1.234',
    '-1',
    '1e2',
    'Infinity',
    'NaN',
    '12 50',
    '2,5,0'
  ]) {
    f.setField('refundAmount', value);
    assert.equal(f.workflow.refundAmountFor(record), null, value);
    assert.equal(f.workflow.canConfirmRefund(record), false, value);
    assert.equal(
      f.workflow.refundValidationMessage(record),
      'admin.messages.montant_de_remboursement_obligatoire'
    );
  }
  f.setField('refundAmount', '0.00');
  assert.equal(f.workflow.canConfirmRefund(record), false);
  assert.equal(f.workflow.refundDraftAmountLabel(record), 'montant invalide');
  f.setField('refundAmount', '250.01');
  assert.equal(f.workflow.canConfirmRefund(record), false);
  assert.match(
    f.workflow.refundValidationMessage(record),
    /montant_maximum_p0/
  );
  f.setField('refundAmount', ' 12,50 ');
  assert.equal(f.workflow.refundAmountFor(record), 12.5);
  assert.equal(f.workflow.canConfirmRefund(record), true);
  assert.equal(f.workflow.isFullRefundDraft(record), false);
  assert.equal(f.workflow.refundDraftAmountLabel(record), '12.50 CAD');
  assert.match(
    f.workflow.refundValidationMessage(record),
    /admin.messages.partiel/
  );
  f.setField('refundAmount', '250,00');
  assert.equal(f.workflow.isFullRefundDraft(record), true);
  assert.match(
    f.workflow.refundValidationMessage(record),
    /admin.messages.complet/
  );
});

test('confirmation and notification validation block HTTP and preserve the editable draft', async () => {
  const f = fixture();
  const record = f.state.record;
  f.workflow.openRefundPanel(record);
  const scenarios = [
    ['confirmationText', '', 'texte_de_confirmation_obligatoire'],
    [
      'confirmationText',
      'incorrect',
      'le_texte_ne_correspond_pas_a_la_reference_demandee'
    ],
    ['confirmationText', record.public_reference, null],
    ['recipientEmail', 'invalid', 'destinataire_courriel_requis'],
    ['recipientEmail', 'synthetic-sponsor@example.test', null],
    ['sponsorMessage', ' ', 'message_au_commanditaire_obligatoire']
  ];
  for (const [field, value, key] of scenarios) {
    f.setField(field, value);
    if (!key) continue;
    await f.workflow.confirmRefund(record);
    assert.equal(f.workflow.canConfirmRefund(record), false);
    assert.equal(f.messages.at(-1).message, `admin.messages.${key}`);
    assert.equal(f.messages.at(-1).autoHide, true);
    assert.equal(f.workflow.isRefundPanelOpen(record), true);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.transitions, []);
  f.workflow.setRefundDraftBoolean(record.id, 'notifySponsor', {
    target: { checked: false }
  });
  assert.equal(f.workflow.canConfirmRefund(record), true);
  assert.match(
    f.workflow.refundValidationMessage(record),
    /pret_a_declencher_le_remboursement_stripe/
  );
});

test('owner rights, selection, version and action state block opening and submission', async (t) => {
  const scenarios = [
    ['owner', false],
    ['token', ''],
    ['destroyed', true],
    ['loading', true],
    ['action', 'synthetic-other-action'],
    ['record', sponsor({ id: 'synthetic-other-sponsor' })],
    ['record', sponsor({ version: 'synthetic-version-2' })]
  ];
  for (const [field, value] of scenarios) {
    await t.test(`${field}:${JSON.stringify(value)}`, async () => {
      const f = fixture();
      const record = f.state.record;
      f.state[field] = value;
      assert.equal(f.workflow.openRefundPanel(record), false);
      assert.deepEqual(f.workflow.refundDrafts(), {});
      f.state[field] = fixture().state[field];
      f.ready();
      f.state[field] = value;
      await f.workflow.confirmRefund(record);
      assert.deepEqual(f.calls, []);
      assert.deepEqual(f.transitions, []);
    });
  }
});

test('financial eligibility keeps processing, manual completion and paid partial refunds distinct', () => {
  const scenarios = [
    [{ payment_status: 'pending' }, false],
    [{ payment_status: 'refunded' }, false],
    [{ payment_status: 'disputed' }, false],
    [{ sponsorship_refund_status: 'processing' }, false],
    [{ sponsorship_refund_status: 'completed' }, false],
    [
      {
        sponsorship_refund_status: 'completed',
        sponsorship_refund_id: 'synthetic-refund'
      },
      true
    ],
    [{ sponsorship_refund_status: 'requested' }, true],
    [{ sponsorship_refund_status: 'failed' }, true]
  ];
  for (const [overrides, eligible] of scenarios) {
    const f = fixture(sponsor(overrides));
    assert.equal(f.workflow.canRefundSponsorship(f.state.record), eligible);
    assert.equal(f.workflow.openRefundPanel(f.state.record), eligible);
  }
  const processing = sponsor({ sponsorship_refund_status: 'processing' });
  const completed = sponsor({ sponsorship_refund_status: 'completed' });
  assert.equal(
    fixture(processing).workflow.refundValidationMessage(processing),
    'admin.messages.un_remboursement_est_deja_en_cours'
  );
  assert.equal(
    fixture(completed).workflow.refundValidationMessage(completed),
    'admin.messages.remboursement_manuel_deja_marque_comme_complete'
  );
});

test('submission preserves trimmed payload, expected version, lock and server reload before success', async () => {
  const f = fixture();
  const record = f.state.record;
  const pendingRefund = deferred();
  const pendingReload = deferred();
  f.ports.admin.refundSponsorship = (token, payload) => {
    f.calls.push({ token, payload });
    return pendingRefund.promise;
  };
  f.ports.reloadSponsorships = () => {
    f.reloads.push(f.state.action);
    return pendingReload.promise;
  };
  f.ready();
  f.setField('confirmationText', ` ${record.public_reference} `);
  f.setField('refundAmount', '125,50');
  f.setField('refundNote', ' Synthetic refund note ');
  f.setField('recipientEmail', ' synthetic-sponsor@example.test ');
  f.setField('sponsorMessage', ' Synthetic sponsor message ');
  f.workflow.setRefundDraftReason(record.id, {
    target: { value: 'duplicate' }
  });
  const request = f.workflow.confirmRefund(record);
  assert.equal(f.state.action, `refund:${record.id}`);
  assert.equal(f.workflow.closeRefundPanel(), false);
  assert.equal(f.workflow.openRefundPanel(record), false);
  await f.workflow.confirmRefund(record);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], {
    token: 'synthetic-token',
    payload: {
      contributionId: record.id,
      expectedVersion: record.version,
      confirmationText: record.public_reference,
      amount: 125.5,
      refundReason: 'duplicate',
      refundNote: 'Synthetic refund note',
      notifySponsor: true,
      notificationEmail: 'synthetic-sponsor@example.test',
      sponsorMessage: 'Synthetic sponsor message'
    }
  });
  pendingRefund.resolve(refundResult({ fullRefund: false, amount: 125.5 }));
  await Promise.resolve();
  assert.deepEqual(f.reloads, [`refund:${record.id}`]);
  assert.equal(f.workflow.isRefundPanelOpen(record), true);
  assert.deepEqual(f.pulses, []);
  pendingReload.resolve();
  await request;
  assert.equal(f.workflow.isRefundPanelOpen(record), false);
  assert.deepEqual(f.pulses, [record.id]);
  assert.deepEqual(f.transitions, [`refund:${record.id}`, null]);
  assert.equal(f.messages.at(-1).autoHide, true);
  assert.match(f.messages.at(-1).message, /admin.messages.partiel/);
});

test('notification opt-out omits email, message and empty note from the request', async () => {
  const f = fixture();
  const record = f.state.record;
  f.ready();
  f.workflow.setRefundDraftBoolean(record.id, 'notifySponsor', {
    target: { checked: false }
  });
  f.setField('recipientEmail', 'invalid');
  f.setField('sponsorMessage', '');
  f.setField('refundNote', '  ');
  await f.workflow.confirmRefund(record);
  assert.equal(f.calls[0].payload.notifySponsor, false);
  assert.equal(f.calls[0].payload.notificationEmail, undefined);
  assert.equal(f.calls[0].payload.sponsorMessage, undefined);
  assert.equal(f.calls[0].payload.refundNote, undefined);
  assert.equal(f.calls[0].payload.amount, 250);
});

test('known failures preserve drafts and delegate unauthorized and conflict errors to the page', async (t) => {
  for (const status of [401, 409, 500]) {
    await t.test(`${status}`, async () => {
      const f = fixture();
      const record = f.state.record;
      const failure = new AdminDashboardRequestError(
        status,
        'Synthetic request failure'
      );
      f.ready();
      f.setField('refundNote', 'Synthetic draft retained after failure');
      const draft = f.workflow.refundDraftFor(record);
      f.ports.admin.refundSponsorship = async (token, payload) => {
        f.calls.push({ token, payload });
        throw failure;
      };
      await f.workflow.confirmRefund(record);
      assert.equal(f.calls.length, 1);
      assert.equal(f.workflow.isRefundPanelOpen(record), true);
      assert.equal(f.workflow.refundDraftFor(record), draft);
      assert.equal(f.errors[0].error, failure);
      assert.match(
        f.errors[0].fallback,
        /action_impossible_le_remboursement_stripe/
      );
      assert.equal(f.messages.at(-1).message, `central-error:${status}`);
      assert.deepEqual(f.reloads, []);
      assert.deepEqual(f.pulses, []);
      assert.deepEqual(f.transitions, [`refund:${record.id}`, null]);
    });
  }
});

test('an uncertain result closes and reconciles the server state with no replay or success pulse', async () => {
  const f = fixture();
  const record = f.state.record;
  const pendingReload = deferred();
  f.ready();
  const draft = f.workflow.refundDraftFor(record);
  f.ports.admin.refundSponsorship = async (token, payload) => {
    f.calls.push({ token, payload });
    throw new AdminDashboardRequestError(
      503,
      'Synthetic uncertain result',
      'SPONSORSHIP_REFUND_UNCERTAIN'
    );
  };
  f.ports.reloadSponsorships = async () => {
    f.reloads.push(f.state.action);
    assert.equal(f.workflow.activeRefundId(), null);
    await pendingReload.promise;
    f.state.record = sponsor({
      version: 'synthetic-version-2',
      sponsorship_refund_status: 'processing'
    });
  };
  const request = f.workflow.confirmRefund(record);
  await Promise.resolve();
  assert.equal(f.workflow.isRefundPanelOpen(record), false);
  assert.equal(f.state.action, `refund:${record.id}`);
  await f.workflow.confirmRefund(record);
  assert.equal(f.calls.length, 1);
  pendingReload.resolve();
  await request;
  assert.deepEqual(f.reloads, [`refund:${record.id}`]);
  assert.equal(f.workflow.refundDraftFor(record), draft);
  assert.equal(
    f.messages.at(-1).message,
    'admin.messages.refund_awaiting_confirmation'
  );
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.pulses, []);
  assert.deepEqual(f.transitions, [`refund:${record.id}`, null]);
  assert.equal(f.workflow.openRefundPanel(f.state.record), false);
  await f.workflow.confirmRefund(record);
  await f.workflow.confirmRefund(f.state.record);
  assert.equal(f.calls.length, 1);
});

test('a page-handled reload failure keeps its error policy and prevents financial replay', async (t) => {
  for (const uncertain of [false, true]) {
    await t.test(
      uncertain ? 'uncertain result' : 'confirmed result',
      async () => {
        const f = fixture();
        const record = f.state.record;
        const reloadFailure = new AdminDashboardRequestError(
          503,
          'Synthetic refresh failure'
        );
        f.ready();
        f.ports.admin.refundSponsorship = async (token, payload) => {
          f.calls.push({ token, payload });
          if (uncertain) {
            throw new AdminDashboardRequestError(
              503,
              'Synthetic uncertain result',
              'SPONSORSHIP_REFUND_UNCERTAIN'
            );
          }
          return refundResult();
        };
        // The page owns loading failures: it clears server records and reports a
        // central error while completing reloadSponsorships without throwing.
        f.ports.reloadSponsorships = async () => {
          f.reloads.push(f.state.action);
          f.state.record = null;
          f.ports.messageFromError(reloadFailure, '');
        };
        await f.workflow.confirmRefund(record);
        assert.equal(f.workflow.isRefundPanelOpen(record), false);
        assert.equal(f.errors[0].error, reloadFailure);
        assert.equal(f.errors.length, 1);
        assert.equal(f.state.action, null);
        assert.equal(f.calls.length, 1);
        assert.equal(f.reloads.length, 1);
        assert.equal(f.pulses.length, uncertain ? 0 : 1);
        assert.match(
          f.messages.at(-1).message,
          uncertain
            ? /refund_awaiting_confirmation/
            : /remboursement_stripe_p0_cree/
        );
        assert.equal(f.workflow.openRefundPanel(record), false);
        await f.workflow.confirmRefund(record);
        assert.equal(f.calls.length, 1);
      }
    );
  }
});

test('result labels retain status, workflow, reason, credit and partial refund information', () => {
  const f = fixture();
  const result = refundResult();
  f.workflow.refundResultLabel(result);
  const presentation = f.translations.at(-1);
  assert.equal(
    presentation.key,
    'admin.messages.remboursement_stripe_p0_cree_p1_p2_p3_p4_p5_p6'
  );
  assert.deepEqual(presentation.params, {
    p0: 'admin.messages.complet',
    p1: '250.00 CAD',
    p2: 'admin.messages.raison_p0:{"p0":"reason:requested_by_customer"}',
    p3: 'admin.messages.statut_stripe_p0:{"p0":"succeeded"}',
    p4: ' Suivi: workflow:completed.',
    p5: 'admin.messages.commandite_marquee_comme_remboursee',
    p6: 'admin.messages.avoir_cree_p0:{"p0":"SYNTHETIC-CREDIT-1"}'
  });
  f.workflow.refundResultLabel(
    refundResult({
      fullRefund: false,
      refundStatus: null,
      paymentStatusUpdated: false,
      creditNote: null
    })
  );
  assert.equal(f.translations.at(-1).params.p0, 'admin.messages.partiel');
  assert.equal(f.translations.at(-1).params.p3, '');
  assert.equal(f.translations.at(-1).params.p5, '');
  assert.equal(f.translations.at(-1).params.p6, '');
});

test('notification presentation distinguishes sent, queued, failed and absent notification', () => {
  const f = fixture();
  const cases = [
    [undefined, ''],
    [
      { sent: true, queued: true },
      'admin.messages.courriel_de_remboursement_avoir_envoye'
    ],
    [
      { sent: false, queued: true },
      'admin.messages.courriel_de_remboursement_avoir_mis_en_file'
    ],
    [
      { sent: false, queued: false, error: null },
      'admin.messages.courriel_de_remboursement_avoir_non_envoye'
    ],
    [
      { sent: false, queued: false, error: 'Synthetic delivery failure' },
      'Courriel de remboursement/avoir non envoye: Synthetic delivery failure'
    ]
  ];
  for (const [notification, label] of cases) {
    assert.equal(
      f.workflow.refundNotificationResultLabel(refundResult({ notification })),
      label
    );
  }
});

test('a failed notification keeps the server-confirmed refund successful and visible', async () => {
  const f = fixture();
  f.ready();
  f.ports.admin.refundSponsorship = async () =>
    refundResult({
      notification: {
        sent: false,
        queued: false,
        error: 'Synthetic delivery failure'
      }
    });
  await f.workflow.confirmRefund(f.state.record);
  assert.match(f.messages.at(-1).message, /remboursement_stripe_p0_cree/);
  assert.match(f.messages.at(-1).message, /Synthetic delivery failure/);
  assert.equal(f.workflow.activeRefundId(), null);
  assert.deepEqual(f.pulses, [f.state.record.id]);
  assert.deepEqual(f.errors, []);
});
