import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AdminSponsorReviewWorkflow } from '../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-review-workflow.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const sponsor = (overrides = {}) => ({
  id: 'synthetic-sponsor',
  version: 'synthetic-version-1',
  sponsor_company_name: 'Synthetic company',
  public_name: 'Synthetic public name',
  sponsor_contact_email: 'synthetic-sponsor@example.test',
  sponsor_review_status: 'pending_review',
  sponsor_review_note: 'Synthetic server note',
  payment_status: 'paid',
  sponsorship_refund_status: 'not_requested',
  ...overrides
});

const reviewResult = (overrides = {}) => ({ updated: true, ...overrides });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const fixture = (t, record = sponsor()) => {
  const state = {
    record,
    manage: true,
    token: 'synthetic-token',
    destroyed: false,
    loading: false,
    action: null,
    selected: record.id,
    revision: 0
  };
  const calls = [];
  const confirmations = [];
  const errors = [];
  const transitions = [];
  const reloads = [];
  const pulses = [];
  const feedback = [];
  const opened = [];
  const ports = {
    admin: {
      async reviewSponsorship(token, payload) {
        calls.push({ token, payload });
        return reviewResult();
      }
    },
    adminToken: () => state.token,
    canActOn: (candidate) =>
      state.manage &&
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
    selectionRevision: () => state.revision,
    isCurrentSelection: (id) => !state.destroyed && state.selected === id,
    async confirm(message, detail) {
      confirmations.push({ message, detail });
      return true;
    },
    canManage: () => state.manage,
    paymentEligibilityMessage: () => 'synthetic-payment-ineligibility',
    openRejectionPanel: (record) => opened.push(record),
    beginApprovalFeedback: (id) => {
      const attempt = id ? { id, phase: 'pending' } : null;
      feedback.push({ attempt });
      return attempt;
    },
    finishApprovalFeedback: (attempt, phase) =>
      feedback.push({ attempt, phase }),
    pulseSelection: (id) => pulses.push(id),
    refundWorkflowStatusLabel: (status) => `workflow:${status}`,
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)
  };
  const workflow = new AdminSponsorReviewWorkflow(ports);
  workflow.reconcile([], [record], false);
  t.after(() => workflow.dispose());
  const setField = (field, value, id = record.id) =>
    workflow.setRejectionDraftField(id, field, { target: { value } });
  const ready = () => {
    workflow.openRejectionPanel(record);
    workflow.setReviewNoteValue(record.id, ' Synthetic internal reason ');
  };
  return {
    workflow,
    ports,
    state,
    calls,
    confirmations,
    errors,
    transitions,
    reloads,
    pulses,
    feedback,
    opened,
    setField,
    ready
  };
};

test('review routes refusal to the page and never mutates unchanged status', async (t) => {
  const f = fixture(t);
  await f.workflow.review(f.state.record, 'pending_review');
  await f.workflow.review(f.state.record, 'rejected');
  assert.deepEqual(f.opened, [f.state.record]);
  assert.deepEqual(f.workflow.rejectionDrafts(), {});
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.transitions, []);
});

test('opening and closing refusal keep drafts, defaults and sponsor isolation', (t) => {
  const f = fixture(t);
  const record = f.state.record;
  assert.equal(f.workflow.openRejectionPanel(record), true);
  assert.equal(f.workflow.isRejectionPanelOpen(record), true);
  const initial = f.workflow.rejectionDraftFor(record);
  assert.equal(initial.notifySponsor, true);
  assert.equal(initial.recipientEmail, record.sponsor_contact_email);
  assert.match(initial.sponsorMessage, /Synthetic company/);
  assert.equal(initial.refundHandling, 'none');
  assert.equal(initial.refundNote, '');
  f.setField('refundNote', 'Synthetic retained refund note');
  f.setField('recipientEmail', 'synthetic-correction@example.test');
  assert.equal(f.workflow.closeRejectionPanel(), true);
  assert.equal(f.workflow.activeRejectionId(), null);
  assert.equal(f.workflow.openRejectionPanel(record), true);
  assert.equal(
    f.workflow.rejectionDraftFor(record).refundNote,
    'Synthetic retained refund note'
  );
  f.setField('sponsorMessage', 'Synthetic other message', 'synthetic-other');
  f.workflow.setRejectionDraftBoolean('synthetic-other', 'notifySponsor', {
    target: { checked: true }
  });
  f.workflow.setRejectionRefundHandling('synthetic-other', {
    target: { value: 'manual_required' }
  });
  assert.deepEqual(f.workflow.rejectionDrafts()['synthetic-other'], {
    notifySponsor: true,
    recipientEmail: '',
    sponsorMessage: 'Synthetic other message',
    refundHandling: 'manual_required',
    refundNote: ''
  });
  assert.equal(
    f.workflow.rejectionDraftFor(record).recipientEmail,
    'synthetic-correction@example.test'
  );
  const absent = sponsor({
    sponsor_company_name: null,
    public_name: null,
    sponsor_contact_email: null
  });
  const missing = fixture(t, absent).workflow.rejectionDraftFor(absent);
  assert.equal(missing.notifySponsor, false);
  assert.equal(missing.recipientEmail, '');
  assert.match(missing.sponsorMessage, /votre organisation/);
  assert.deepEqual(f.calls, []);
});

test('refusal requires internal reason and valid notification before any request', async (t) => {
  const f = fixture(t);
  const record = f.state.record;
  f.workflow.openRejectionPanel(record);
  f.workflow.setReviewNoteValue(record.id, ' ');
  await f.workflow.confirmRejection(record);
  assert.equal(
    f.workflow.reviewMessageFor(record.id),
    'admin.messages.raison_interne_obligatoire'
  );
  f.workflow.setReviewNote(record.id, {
    target: { value: 'Synthetic reason' }
  });
  f.setField('recipientEmail', 'invalid');
  await f.workflow.confirmRejection(record);
  assert.equal(
    f.workflow.reviewMessageFor(record.id),
    'admin.messages.destinataire_courriel_requis'
  );
  f.setField('recipientEmail', ' synthetic-sponsor@example.test ');
  f.setField('sponsorMessage', ' ');
  await f.workflow.confirmRejection(record);
  assert.equal(
    f.workflow.reviewMessageFor(record.id),
    'admin.messages.message_au_commanditaire_obligatoire'
  );
  assert.equal(f.workflow.canConfirmRejection(record), false);
  f.workflow.setRejectionDraftBoolean(record.id, 'notifySponsor', {
    target: { checked: false }
  });
  assert.equal(f.workflow.canConfirmRejection(record), true);
  assert.equal(
    f.workflow.rejectionValidationMessage(record),
    'admin.messages.pret_a_refuser_sans_courriel'
  );
  assert.equal(f.workflow.isRejectionPanelOpen(record), true);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.transitions, []);
});

test('approval preserves payment and refund eligibility without a new financial decision', async (t) => {
  for (const overrides of [
    { payment_status: 'pending' },
    { payment_status: 'refunded' },
    { payment_status: 'disputed' },
    { sponsorship_refund_status: 'requested' },
    { sponsorship_refund_status: 'processing' }
  ]) {
    const f = fixture(t, sponsor(overrides));
    assert.equal(f.workflow.canApproveSponsorship(f.state.record), false);
    await f.workflow.review(f.state.record, 'approved');
    assert.equal(
      f.workflow.reviewMessageFor(f.state.record.id),
      'synthetic-payment-ineligibility'
    );
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(t, sponsor({ sponsorship_refund_status: 'completed' }));
  assert.equal(f.workflow.canApproveSponsorship(f.state.record), true);
  f.ports.paymentEligibilityMessage = () => '';
  await f.workflow.review(sponsor({ payment_status: 'pending' }), 'approved');
  assert.equal(
    f.workflow.reviewMessageFor(f.state.record.id),
    'admin.messages.action_impossible_le_paiement_n_est_pas_admissible'
  );
});

test('permissions, version, token, loading and action lock block all review mutations', async (t) => {
  for (const [field, value] of [
    ['manage', false],
    ['token', ''],
    ['destroyed', true],
    ['loading', true],
    ['action', 'synthetic-other-action'],
    ['record', sponsor({ id: 'synthetic-other' })],
    ['record', sponsor({ version: 'synthetic-version-2' })]
  ]) {
    const f = fixture(t);
    const record = f.state.record;
    f.ready();
    f.state[field] = value;
    assert.equal(f.workflow.openRejectionPanel(record), false);
    await f.workflow.review(record, 'approved');
    await f.workflow.confirmRejection(record);
    await f.workflow.saveReviewNote(record);
    assert.deepEqual(f.calls, [], field);
    assert.deepEqual(f.transitions, [], field);
  }
});

test('confirmation rechecks permissions, version, lock and selection even after leaving and returning', async (t) => {
  for (const [field, value] of [
    ['manage', false],
    ['token', ''],
    ['destroyed', true],
    ['loading', true],
    ['action', 'synthetic-other-action'],
    [
      'record',
      sponsor({
        version: 'synthetic-version-2',
        sponsor_review_status: 'approved'
      })
    ],
    ['selected', 'synthetic-other'],
    ['revision', 2]
  ]) {
    const f = fixture(t, sponsor({ sponsor_review_status: 'approved' }));
    const pending = deferred();
    f.ports.confirm = () => pending.promise;
    const request = f.workflow.review(f.state.record, 'pending_review');
    f.state[field] = value;
    pending.resolve(true);
    await request;
    assert.deepEqual(f.calls, [], field);
    assert.deepEqual(f.feedback, [], field);
  }
  const f = fixture(t, sponsor({ sponsor_review_status: 'approved' }));
  f.ports.confirm = async () => false;
  await f.workflow.review(f.state.record, 'pending_review');
  assert.deepEqual(f.calls, []);
  f.ports.confirm = async (message) => {
    f.confirmations.push(message);
    return true;
  };
  await f.workflow.review(f.state.record, 'pending_review');
  assert.equal(
    f.confirmations.at(-1),
    'admin.messages.remettre_ce_dossier_en_attente'
  );
  assert.equal(f.calls[0].payload.reviewStatus, 'pending_review');
  assert.equal(f.feedback[0].attempt, null);
});

test('approval uses the version and trimmed note, keeps lock and feedback pending until reload', async (t) => {
  const f = fixture(t);
  const record = f.state.record;
  const mutation = deferred();
  const reload = deferred();
  f.workflow.setReviewNoteValue(record.id, ' Synthetic approval note ');
  f.ports.admin.reviewSponsorship = (token, payload) => {
    f.calls.push({ token, payload });
    return mutation.promise;
  };
  f.ports.reloadSponsorships = () => {
    f.reloads.push(f.state.action);
    return reload.promise;
  };
  const request = f.workflow.review(record, 'approved');
  assert.equal(f.state.action, `review:${record.id}`);
  assert.match(f.workflow.reviewMessageFor(record.id), /action_en_cours/);
  assert.equal(f.feedback[0].attempt.phase, 'pending');
  await f.workflow.review(record, 'approved');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], {
    token: 'synthetic-token',
    payload: {
      contributionId: record.id,
      reviewStatus: 'approved',
      reviewNote: 'Synthetic approval note',
      expectedVersion: record.version
    }
  });
  mutation.resolve(reviewResult());
  await Promise.resolve();
  assert.deepEqual(f.reloads, [`review:${record.id}`]);
  assert.equal(f.feedback.length, 1);
  assert.deepEqual(f.pulses, []);
  reload.resolve();
  await request;
  assert.equal(f.feedback.at(-1).phase, 'success');
  assert.equal(f.feedback.at(-1).attempt, f.feedback[0].attempt);
  assert.equal(
    f.workflow.reviewMessageFor(record.id),
    'admin.messages.action_confirmee_commandite_acceptee'
  );
  assert.deepEqual(f.pulses, [record.id]);
  assert.deepEqual(f.transitions, [`review:${record.id}`, null]);
});

test('refusal sends complete trimmed form once and waits for server refresh before closing', async (t) => {
  const f = fixture(t);
  const record = f.state.record;
  f.ready();
  f.setField('recipientEmail', ' synthetic-correction@example.test ');
  f.setField('sponsorMessage', ' Synthetic sponsor message ');
  f.setField('refundNote', ' Synthetic manual refund note ');
  f.workflow.setRejectionRefundHandling(record.id, {
    target: { value: 'manual_required' }
  });
  const mutation = deferred();
  const reload = deferred();
  f.ports.admin.reviewSponsorship = (token, payload) => {
    f.calls.push({ token, payload });
    return mutation.promise;
  };
  f.ports.reloadSponsorships = () => {
    f.reloads.push(f.state.action);
    return reload.promise;
  };
  const request = f.workflow.confirmRejection(record);
  assert.equal(f.workflow.closeRejectionPanel(), false);
  await f.workflow.confirmRejection(record);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].payload, {
    contributionId: record.id,
    reviewStatus: 'rejected',
    reviewNote: 'Synthetic internal reason',
    expectedVersion: record.version,
    notifySponsor: true,
    notificationEmail: 'synthetic-correction@example.test',
    sponsorMessage: 'Synthetic sponsor message',
    refundHandling: 'manual_required',
    refundNote: 'Synthetic manual refund note'
  });
  mutation.resolve(
    reviewResult({
      refundHandling: 'manual_required',
      refundWorkflowStatus: 'requested',
      notification: { queued: true, sent: false }
    })
  );
  await Promise.resolve();
  assert.equal(f.workflow.isRejectionPanelOpen(record), true);
  assert.deepEqual(f.pulses, []);
  reload.resolve();
  await request;
  assert.equal(f.workflow.isRejectionPanelOpen(record), false);
  assert.match(f.workflow.reviewMessageFor(record.id), /commandite_refusee/);
  assert.match(f.workflow.reviewMessageFor(record.id), /courriel_mis_en_file/);
  assert.match(f.workflow.reviewMessageFor(record.id), /workflow:requested/);
  assert.equal(
    f.workflow.rejectionDraftFor(record).refundNote,
    ' Synthetic manual refund note '
  );
  assert.deepEqual(f.pulses, [record.id]);
  assert.deepEqual(f.feedback, []);
});

test('refusal opt-out omits notification details without losing local fields', async (t) => {
  const f = fixture(t);
  const record = f.state.record;
  f.ready();
  f.workflow.setRejectionDraftBoolean(record.id, 'notifySponsor', {
    target: { checked: false }
  });
  f.setField('recipientEmail', 'invalid');
  f.setField('sponsorMessage', '');
  f.setField('refundNote', ' ');
  await f.workflow.confirmRejection(record);
  assert.equal(f.calls[0].payload.notificationEmail, undefined);
  assert.equal(f.calls[0].payload.sponsorMessage, undefined);
  assert.equal(f.calls[0].payload.refundNote, undefined);
  assert.equal(f.calls[0].payload.notifySponsor, false);
  assert.equal(f.workflow.rejectionDraftFor(record).recipientEmail, 'invalid');
  assert.match(f.workflow.reviewMessageFor(record.id), /aucun_courriel_envoye/);
});

test('401, 409 and generic errors delegate to the page, release lock and retain drafts', async (t) => {
  for (const status of [401, 409, 500]) {
    for (const action of ['review', 'rejection', 'note']) {
      const f = fixture(t);
      const record = f.state.record;
      const failure = new AdminDashboardRequestError(
        status,
        'Synthetic failure'
      );
      f.ready();
      f.setField('refundNote', 'Synthetic retained manual refund note');
      const draft = f.workflow.rejectionDraftFor(record);
      f.ports.admin.reviewSponsorship = async () => {
        throw failure;
      };
      if (action === 'review') await f.workflow.review(record, 'approved');
      if (action === 'rejection') await f.workflow.confirmRejection(record);
      if (action === 'note') await f.workflow.saveReviewNote(record);
      assert.equal(f.errors[0].error, failure);
      assert.equal(f.state.action, null);
      assert.equal(f.workflow.rejectionDraftFor(record), draft);
      assert.equal(
        f.workflow.reviewNoteFor(record.id),
        ' Synthetic internal reason '
      );
      assert.equal(f.workflow.isRejectionPanelOpen(record), true);
      assert.deepEqual(f.reloads, []);
      assert.deepEqual(f.pulses, []);
      const message =
        action === 'note'
          ? f.workflow.reviewNoteStateLabel(record)
          : f.workflow.reviewMessageFor(record.id);
      assert.equal(message, `central-error:${status}`);
      if (action === 'review') assert.equal(f.feedback.at(-1).phase, 'error');
    }
  }
});

test('an unconfirmed approval result never announces success or reloads', async (t) => {
  const f = fixture(t);
  f.ports.admin.reviewSponsorship = async () =>
    reviewResult({ updated: false });
  await f.workflow.review(f.state.record, 'approved');
  assert.equal(f.errors.length, 1);
  assert.equal(f.feedback.at(-1).phase, 'error');
  assert.deepEqual(f.reloads, []);
  assert.deepEqual(f.pulses, []);
});

test('reload reconciliation preserves dirty notes and refusals while refreshing untouched fields', (t) => {
  const f = fixture(t);
  const first = f.state.record;
  const second = sponsor({
    id: 'synthetic-second',
    sponsor_review_note: 'Synthetic second server note'
  });
  f.workflow.reconcile([first], [first, second], false);
  f.workflow.openRejectionPanel(first);
  f.workflow.setReviewNoteValue(first.id, 'Synthetic unsaved note');
  f.setField('sponsorMessage', 'Synthetic edited message');
  f.setField('refundNote', 'Synthetic edited refund note');
  f.workflow.setRejectionRefundHandling(first.id, {
    target: { value: 'manual_completed' }
  });
  const refreshed = sponsor({
    version: 'synthetic-version-2',
    sponsor_review_note: 'Synthetic refreshed note',
    sponsor_contact_email: 'synthetic-new-contact@example.test'
  });
  const secondRefreshed = {
    ...second,
    sponsor_review_note: 'Synthetic refreshed second note'
  };
  f.workflow.reconcile([first, second], [refreshed, secondRefreshed], true);
  assert.equal(f.workflow.reviewNoteFor(first.id), 'Synthetic unsaved note');
  assert.equal(
    f.workflow.reviewNoteFor(second.id),
    secondRefreshed.sponsor_review_note
  );
  assert.equal(
    f.workflow.rejectionDraftFor(refreshed).recipientEmail,
    refreshed.sponsor_contact_email
  );
  assert.equal(
    f.workflow.rejectionDraftFor(refreshed).sponsorMessage,
    'Synthetic edited message'
  );
  assert.equal(
    f.workflow.rejectionDraftFor(refreshed).refundNote,
    'Synthetic edited refund note'
  );
  assert.equal(
    f.workflow.rejectionDraftFor(refreshed).refundHandling,
    'manual_completed'
  );
  const retained = f.workflow.rejectionDraftFor(refreshed);
  f.workflow.reconcile([refreshed, secondRefreshed], [refreshed], false);
  assert.equal(
    f.workflow.reviewNoteFor(first.id),
    refreshed.sponsor_review_note
  );
  assert.equal(f.workflow.reviewNoteFor(second.id), '');
  assert.equal(f.workflow.rejectionDraftFor(refreshed), retained);
});

test('notes keep status, trim values, prevent duplicate requests and wait for refreshed server state', async (t) => {
  const f = fixture(t, sponsor({ sponsor_review_status: 'approved' }));
  const record = f.state.record;
  assert.equal(f.workflow.isReviewNoteDirty(record), false);
  await f.workflow.saveReviewNote(record);
  assert.deepEqual(f.calls, []);
  f.workflow.setReviewNoteValue(record.id, ' Synthetic new private note ');
  assert.equal(
    f.workflow.reviewNoteStateLabel(record),
    'admin.dossier.noteEditor.unsaved'
  );
  const mutation = deferred();
  f.ports.admin.reviewSponsorship = (token, payload) => {
    f.calls.push({ token, payload });
    return mutation.promise;
  };
  f.ports.reloadSponsorships = async () => {
    f.reloads.push(f.state.action);
    const refreshed = {
      ...record,
      version: 'synthetic-version-2',
      sponsor_review_note: 'Synthetic new private note'
    };
    f.workflow.reconcile([record], [refreshed], false);
    f.state.record = refreshed;
  };
  const request = f.workflow.saveReviewNote(record);
  assert.equal(
    f.workflow.reviewNoteStateLabel(record),
    'admin.messages.enregistrement_en_cours'
  );
  await f.workflow.saveReviewNote(record);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].payload, {
    contributionId: record.id,
    reviewStatus: 'approved',
    reviewNote: 'Synthetic new private note',
    expectedVersion: record.version
  });
  mutation.resolve(reviewResult());
  await request;
  assert.equal(
    f.workflow.reviewNoteStateLabel(f.state.record),
    'admin.dossier.noteEditor.saved'
  );
  assert.equal(f.workflow.isReviewNoteDirty(f.state.record), false);
  f.workflow.setReviewNoteValue(record.id, ' ');
  assert.equal(
    f.workflow.reviewNoteStateLabel(f.state.record),
    'admin.dossier.noteEditor.unsaved'
  );
  f.ports.admin.reviewSponsorship = async (token, payload) => {
    f.calls.push({ token, payload });
    return reviewResult();
  };
  await f.workflow.saveReviewNote(f.state.record);
  assert.equal(f.calls.at(-1).payload.reviewNote, undefined);
  const empty = sponsor({ sponsor_review_note: null });
  f.workflow.reconcile([], [empty], false);
  f.workflow.setReviewNoteValue(empty.id, '');
  assert.equal(
    f.workflow.reviewNoteStateLabel(empty),
    'admin.dossier.noteEditor.empty'
  );
});

test('late successes and errors after changing selection and returning keep new panel and messages', async (t) => {
  for (const action of ['review', 'rejection', 'note']) {
    for (const failure of [false, true]) {
      const f = fixture(t);
      const record = f.state.record;
      f.ready();
      const pending = deferred();
      f.ports.admin.reviewSponsorship = () => pending.promise;
      const request =
        action === 'review'
          ? f.workflow.review(record, 'approved')
          : action === 'rejection'
            ? f.workflow.confirmRejection(record)
            : f.workflow.saveReviewNote(record);
      f.state.selected = 'synthetic-other';
      f.state.revision++;
      f.workflow.activeRejectionId.set('synthetic-other');
      f.state.selected = record.id;
      f.state.revision++;
      f.workflow.setReviewMessage(record.id, 'Synthetic current message');
      f.workflow.setReviewNoteValue(
        record.id,
        'Synthetic current private note'
      );
      if (failure)
        pending.reject(
          new AdminDashboardRequestError(409, 'Synthetic late conflict')
        );
      else pending.resolve(reviewResult());
      await request;
      assert.equal(
        f.workflow.reviewMessageFor(record.id),
        'Synthetic current message'
      );
      assert.equal(f.workflow.activeRejectionId(), 'synthetic-other');
      assert.equal(
        f.workflow.reviewNoteFor(record.id),
        'Synthetic current private note'
      );
      assert.equal(f.workflow.noteMessages()[record.id], '');
      assert.deepEqual(f.pulses, []);
      assert.equal(f.feedback.filter((entry) => entry.phase).length, 0);
      assert.equal(f.errors.length, failure ? 1 : 0);
      assert.equal(f.reloads.length, failure ? 0 : 1);
      assert.equal(f.state.action, null);
    }
  }
});

test('message replacement and disposal cancel their own three-second timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  const id = f.state.record.id;
  f.workflow.setReviewMessage(id, 'Synthetic first message', true);
  t.mock.timers.tick(2000);
  f.workflow.setReviewMessage(id, 'Synthetic replacement message', true);
  t.mock.timers.tick(1000);
  assert.equal(
    f.workflow.reviewMessageFor(id),
    'Synthetic replacement message'
  );
  t.mock.timers.tick(2000);
  assert.equal(f.workflow.reviewMessageFor(id), '');
  f.workflow.setReviewMessage(id, 'Synthetic persistent message');
  t.mock.timers.tick(3000);
  assert.equal(f.workflow.reviewMessageFor(id), 'Synthetic persistent message');
  f.workflow.setReviewMessage(id, 'Synthetic final message', true);
  f.workflow.dispose();
  t.mock.timers.tick(3000);
  assert.equal(f.workflow.reviewMessageFor(id), 'Synthetic final message');
  f.workflow.setReviewMessage(id, 'Synthetic after disposal');
  assert.equal(f.workflow.reviewMessageFor(id), 'Synthetic final message');
  assert.equal(f.workflow.openRejectionPanel(f.state.record), false);
});

test('disposal prevents late refresh, central errors and UI changes after either outcome', async (t) => {
  for (const action of ['review', 'rejection', 'note']) {
    for (const failure of [false, true]) {
      const f = fixture(t);
      const record = f.state.record;
      f.ready();
      const pending = deferred();
      f.ports.admin.reviewSponsorship = () => pending.promise;
      const request =
        action === 'review'
          ? f.workflow.review(record, 'approved')
          : action === 'rejection'
            ? f.workflow.confirmRejection(record)
            : f.workflow.saveReviewNote(record);
      const reviewMessages = f.workflow.reviewMessages();
      const noteMessages = f.workflow.noteMessages();
      f.workflow.dispose();
      if (failure)
        pending.reject(
          new AdminDashboardRequestError(401, 'Synthetic late expiry')
        );
      else pending.resolve(reviewResult());
      await request;
      assert.deepEqual(f.reloads, []);
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.pulses, []);
      assert.equal(f.workflow.reviewMessages(), reviewMessages);
      assert.equal(f.workflow.noteMessages(), noteMessages);
      assert.equal(f.workflow.activeRejectionId(), record.id);
      assert.equal(f.feedback.filter((entry) => entry.phase).length, 0);
      assert.equal(f.state.action, null);
    }
  }
});

test('FR and EN use existing translations for forms, actions, note states and notification results', async (t) => {
  const phrases = [];
  for (const language of ['fr-CA', 'en']) {
    const dictionary = JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${language}.json`, 'utf8')
    );
    const f = fixture(t);
    const translated = [];
    f.ports.t = (key, params = {}) => {
      const template = key
        .split('.')
        .reduce((value, segment) => value?.[segment], dictionary);
      assert.equal(typeof template, 'string', `${language}:${key}`);
      translated.push(key);
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(params[name] ?? `{{${name}}}`)
      );
    };
    f.ready();
    phrases.push(f.workflow.rejectionDraftFor(f.state.record).sponsorMessage);
    assert.equal(
      f.workflow.reviewNoteStateLabel(f.state.record),
      dictionary.admin.dossier.noteEditor.unsaved
    );
    await f.workflow.confirmRejection(f.state.record);
    assert.equal(
      f.workflow.reviewActionName('approved'),
      dictionary.admin.messages.acceptation
    );
    f.workflow.reviewActionName('pending_review');
    f.workflow.reviewSuccessMessage('pending_review');
    f.workflow.rejectionNotificationResultLabel(
      reviewResult({ notification: { sent: true } })
    );
    f.workflow.rejectionNotificationResultLabel(
      reviewResult({ notification: { queued: true } })
    );
    f.workflow.rejectionNotificationResultLabel(
      reviewResult({
        notification: {
          sent: false,
          queued: false,
          error: 'Synthetic delivery failure'
        }
      })
    );
    f.workflow.rejectionNotificationResultLabel(
      reviewResult({ notification: { sent: false, queued: false } })
    );
    f.workflow.rejectionRefundResultLabel('manual_required', 'requested');
    f.workflow.rejectionRefundResultLabel('manual_completed', 'completed');
    assert.equal(f.workflow.rejectionRefundResultLabel('none'), '');
    assert.ok(
      translated.includes('admin.messages.action_confirmee_commandite_refusee')
    );
  }
  assert.notEqual(phrases[0], phrases[1]);
  assert.match(phrases[0], /Synthetic company/);
  assert.match(phrases[1], /Synthetic company/);
});
