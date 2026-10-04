import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminAssistantController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-assistant-page/admin-assistant-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const at = '2026-09-21T14:00:00Z';
const query = { page: 1, pageSize: 15, overview: true };
const item = (id = 'synthetic-a', changes = {}) => ({
  id,
  type: 'sponsorship_needs_info',
  severity: 'urgent',
  title: 'Synthetic dossier',
  explanation: 'Synthetic explanation',
  detectedAt: at,
  sponsorshipId: id,
  facts: { reference: 'SYNTHETIC-301' },
  suggestedActions: [
    { actionType: 'prepare_reminder', executionMode: 'prepare', label: 'Draft' }
  ],
  ...changes
});
const queue = (items = [item()], changes = {}) => ({
  available: true,
  coverage: 'complete',
  missingSources: [],
  generatedAt: at,
  timezone: 'America/Toronto',
  total: items.length,
  filteredTotal: items.length,
  todayTotal: items.length,
  counts: { urgent: items.length, today: 0, this_week: 0, informational: 0 },
  typeCounts: {},
  page: 1,
  pageSize: 15,
  items,
  ...changes
});
const draft = {
  status: 'ok',
  message: null,
  draft: {
    type: 'sponsorship_reminder',
    title: 'Synthetic draft',
    generatedAt: at,
    reference: 'SYNTHETIC-301',
    sent: false,
    published: false,
    persisted: false,
    fields: [],
    bodyLines: ['Synthetic private draft.'],
    notice: 'No delivery.',
    limitations: []
  }
};
const summary = {
  generatedAt: at,
  financialSummary: {
    grossPaid: 50,
    refunded: 0,
    netReceived: null,
    currency: 'CAD',
    limitations: []
  }
};
const answer = {
  generatedAt: at,
  mode: 'mock',
  enabled: true,
  status: 'ok',
  answer: [
    { kind: 'facts', title: 'Synthetic answer', lines: ['Private answer.'] }
  ],
  links: [],
  toolInvocations: [],
  limitations: [],
  provider: { name: 'fixture', model: null }
};
const context = {
  status: 'empty',
  context: null,
  generatedAt: at,
  conversationMode: 'mock'
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t) {
  const calls = {
    queue: [],
    prepare: [],
    summary: [],
    context: [],
    query: [],
    expired: 0
  };
  const options = { canPrepare: signal(true), language: 'fr-CA' };
  const ports = {
    admin: {
      getWorkQueue: async (token, input) => {
        calls.queue.push({ token, input });
        return queue([item(input.itemId || 'synthetic-a')]);
      },
      prepareAssistantDraft: async (token, input) => {
        calls.prepare.push({ token, input });
        return draft;
      },
      getAssistantSummary: async (token) => {
        calls.summary.push(token);
        return summary;
      },
      getAssistantContext: async (token) => {
        calls.context.push(token);
        return context;
      },
      queryAssistant: async (token, input) => {
        calls.query.push({ token, input });
        return answer;
      }
    },
    token: () => 'synthetic-admin-session',
    canPrepare: () => options.canPrepare(),
    language: () => options.language,
    onSessionExpired: () => {
      calls.expired++;
    }
  };
  const controller = new AdminAssistantController(ports);
  t.after(() => controller.dispose());
  return { controller, ports, calls, options };
}

async function select(c, id = 'synthetic-a') {
  c.setOverview(query, id);
  await settle();
}

async function populate(c) {
  await select(c);
  await c.prepare(c.selected());
  await c.loadSummary(true);
  await c.loadConversation(true);
  c.question.set('Synthetic private question');
  await c.ask();
}

function assertPrivateCleared(c) {
  assert.equal(c.data(), null);
  assert.equal(c.selected(), null);
  assert.equal(c.prepared(), null);
  assert.equal(c.summary(), null);
  assert.equal(c.answer(), null);
  assert.equal(c.question(), '');
  assert.equal(c.conversationMode(), null);
}

test('overview route deduplicates queue reads, selection only loads its detail, and return from context reloads', async (t) => {
  const { controller: c, calls } = fixture(t);
  assert.deepEqual(calls.queue, []);
  assert.equal(c.state(), 'idle');
  c.setOverview(query, 'synthetic-a');
  c.setOverview({ ...query }, 'synthetic-a');
  await settle();
  assert.deepEqual(
    calls.queue.map((call) => call.input),
    [query, { itemId: 'synthetic-a', pageSize: 1 }]
  );
  assert.equal(c.selected().id, 'synthetic-a');
  c.setOverview(query, 'synthetic-b');
  await settle();
  assert.equal(calls.queue.length, 3);
  assert.equal(c.selected().id, 'synthetic-b');
  c.leaveOverview();
  await c.load();
  c.refresh();
  assert.equal(calls.queue.length, 3);
  assert.equal(c.selectedId(), null);
  assert.equal(c.data(), null);
  c.setOverview(query, 'synthetic-b');
  await settle();
  assert.equal(calls.queue.length, 5);
  assert.equal(c.state(), 'ready');
  assert.equal(c.selected().id, 'synthetic-b');
  assert.deepEqual(calls.summary, []);
  assert.deepEqual(calls.context, []);
});

for (const outcome of ['resolve', 'reject']) {
  test(`an older queue ${outcome} cannot replace the newest queue or expire its session`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const old = deferred();
    ports.admin.getWorkQueue = () => old.promise;
    const previous = c.load();
    const latest = queue([item('synthetic-b')]);
    ports.admin.getWorkQueue = async () => latest;
    await c.load();
    if (outcome === 'resolve') old.resolve(queue());
    else old.reject(new AdminDashboardRequestError(401));
    await previous;
    assert.equal(c.data(), latest);
    assert.equal(c.state(), 'ready');
    assert.equal(calls.expired, 0);
  });

  test(`an older detail ${outcome} cannot overwrite a newly selected dossier`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const old = deferred();
    ports.admin.getWorkQueue = async (token, input) =>
      input.itemId === 'synthetic-a'
        ? old.promise
        : queue([item('synthetic-b')]);
    c.setOverview(query, 'synthetic-a');
    await select(c, 'synthetic-b');
    if (outcome === 'resolve') old.resolve(queue());
    else old.reject(new AdminDashboardRequestError(401));
    await settle();
    assert.equal(c.selectedId(), 'synthetic-b');
    assert.equal(c.selected().id, 'synthetic-b');
    assert.equal(c.detailState(), 'ready');
    assert.equal(calls.expired, 0);
  });
}

test('queue and detail refresh have independent generations and closing only cancels the detail', async (t) => {
  const { controller: c, ports } = fixture(t);
  await select(c);
  const pendingQueue = deferred();
  const pendingDetail = deferred();
  ports.admin.getWorkQueue = (token, input) =>
    input.itemId ? pendingDetail.promise : pendingQueue.promise;
  c.refresh();
  c.setOverview(query, null);
  assert.equal(c.selected(), null);
  assert.equal(c.detailState(), 'idle');
  const newest = queue([item('synthetic-b')]);
  pendingQueue.resolve(newest);
  pendingDetail.resolve(queue());
  await settle();
  assert.equal(c.data(), newest);
  assert.equal(c.state(), 'ready');
  assert.equal(c.selectedId(), null);
  assert.equal(c.selected(), null);
  ports.admin.getWorkQueue = async () => queue([item('synthetic-b')]);
  await select(c, 'synthetic-b');
  assert.equal(c.detailState(), 'ready');
  assert.equal(c.selected().id, 'synthetic-b');
});

for (const action of ['close', 'selection', 'refresh', 'context', 'dispose']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`draft ${outcome} after ${action} cannot restore private content or expire another view`, async (t) => {
      const { controller: c, ports, calls } = fixture(t);
      await select(c);
      const pending = deferred();
      ports.admin.prepareAssistantDraft = () => pending.promise;
      const preparation = c.prepare(c.selected());
      if (action === 'close') c.setOverview(query, null);
      else if (action === 'selection') c.setOverview(query, 'synthetic-b');
      else if (action === 'refresh') c.refresh();
      else if (action === 'context') c.leaveOverview();
      else c.dispose();
      await settle();
      if (outcome === 'resolve') pending.resolve(draft);
      else pending.reject(new AdminDashboardRequestError(401));
      await preparation;
      assert.equal(c.prepared(), null);
      assert.equal(c.draftState(), 'idle');
      assert.equal(calls.expired, 0);
    });
  }
}

test('a draft for the new selection wins independently of an older pending preparation', async (t) => {
  const { controller: c, ports } = fixture(t);
  await select(c);
  const old = deferred();
  ports.admin.prepareAssistantDraft = () => old.promise;
  const previous = c.prepare(c.selected());
  await select(c, 'synthetic-b');
  const newest = {
    ...draft,
    draft: { ...draft.draft, reference: 'SYNTHETIC-302' }
  };
  ports.admin.prepareAssistantDraft = async () => newest;
  await c.prepare(c.selected());
  old.resolve(draft);
  await previous;
  assert.equal(c.prepared(), newest);
  assert.equal(c.draftState(), 'ready');
});

test('preparation respects reader permissions, the selected dossier, duplicate clicks and current language', async (t) => {
  const { controller: c, ports, calls, options } = fixture(t);
  options.canPrepare.set(false);
  await select(c);
  await c.prepare(c.selected());
  assert.deepEqual(calls.prepare, []);
  options.canPrepare.set(true);
  await c.prepare(item('synthetic-b'));
  assert.deepEqual(calls.prepare, []);
  options.language = 'en';
  const pending = deferred();
  ports.admin.prepareAssistantDraft = (token, input) => {
    calls.prepare.push({ token, input });
    return pending.promise;
  };
  const preparation = c.prepare(c.selected());
  await c.prepare(c.selected());
  assert.deepEqual(calls.prepare, [
    {
      token: 'synthetic-admin-session',
      input: {
        type: 'sponsorship_reminder',
        reference: 'synthetic-a',
        language: 'en'
      }
    }
  ]);
  pending.resolve(draft);
  await preparation;
  assert.equal(c.prepared().draft.sent, false);
  assert.equal(c.prepared().draft.published, false);
  options.canPrepare.set(false);
  await c.prepare(c.selected());
  assert.equal(calls.prepare.length, 1);
});

for (const [actionType, type, changes, reference] of [
  ['prepare_reminder', 'sponsorship_reminder', {}, 'synthetic-a'],
  [
    'prepare_publication',
    'publication_draft',
    { sponsorshipId: undefined, publicationId: 'synthetic-publication' },
    'synthetic-publication'
  ],
  ['prepare_note', 'admin_note', { sponsorshipId: undefined }, 'SYNTHETIC-301'],
  ['propose_slot', 'slot_proposal', { sponsorshipId: undefined, facts: {} }, '']
]) {
  test(`${actionType} preserves its existing preparation payload without any send or publication port`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const current = item('synthetic-a', {
      ...changes,
      suggestedActions: [
        { actionType, executionMode: 'prepare', label: 'Draft' }
      ]
    });
    ports.admin.getWorkQueue = async () => queue([current]);
    await select(c);
    await c.prepare(current);
    assert.deepEqual(calls.prepare[0].input, {
      type,
      reference,
      language: 'fr-CA'
    });
    assert.equal(
      c.prepareType(
        item('synthetic-a', {
          suggestedActions: [
            {
              actionType: 'prepare_note',
              executionMode: 'navigate',
              label: 'Open'
            }
          ]
        })
      ),
      undefined
    );
  });
}

test('summary and conversation load only when opened, deduplicate pending reads, and questions are trimmed', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  await c.loadSummary(false);
  await c.loadConversation(false);
  c.question.set('Private question');
  await c.ask();
  assert.deepEqual(calls.summary, []);
  assert.deepEqual(calls.context, []);
  assert.deepEqual(calls.query, []);
  const pendingSummary = deferred();
  const pendingContext = deferred();
  ports.admin.getAssistantSummary = (token) => {
    calls.summary.push(token);
    return pendingSummary.promise;
  };
  ports.admin.getAssistantContext = (token) => {
    calls.context.push(token);
    return pendingContext.promise;
  };
  const summaryRead = c.loadSummary(true);
  const contextRead = c.loadConversation(true);
  await c.loadSummary(true);
  await c.loadConversation(true);
  assert.equal(calls.summary.length, 1);
  assert.equal(calls.context.length, 1);
  pendingSummary.resolve(summary);
  pendingContext.resolve(context);
  await Promise.all([summaryRead, contextRead]);
  await c.loadSummary(true);
  await c.loadConversation(true);
  c.question.set('  Synthetic question  ');
  const pendingAnswer = deferred();
  ports.admin.queryAssistant = (token, input) => {
    calls.query.push({ token, input });
    return pendingAnswer.promise;
  };
  const asking = c.ask();
  await c.ask();
  assert.deepEqual(calls.query, [
    {
      token: 'synthetic-admin-session',
      input: { message: 'Synthetic question' }
    }
  ]);
  pendingAnswer.resolve(answer);
  await asking;
  assert.equal(c.answer(), answer);
  assert.equal(c.summary(), summary);
  c.question.set('   ');
  await c.ask();
  c.question.set('Private question');
  c.conversationMode.set('disabled');
  await c.ask();
  assert.equal(calls.query.length, 1);
});

test('unavailable and resolved detail differ from errors; refresh errors retain a disabled stale queue', async (t) => {
  const { controller: c, ports } = fixture(t);
  await select(c);
  const previous = c.data();
  ports.admin.getWorkQueue = async () => {
    throw new AdminDashboardRequestError(503);
  };
  await c.load();
  assert.equal(c.state(), 'error');
  assert.equal(c.data(), previous);
  ports.admin.getWorkQueue = async () =>
    queue([], { available: false, coverage: 'unavailable' });
  c.refresh();
  await settle();
  assert.equal(c.state(), 'unavailable');
  assert.equal(c.detailState(), 'unavailable');
  assert.equal(c.data(), null);
  assert.equal(c.selected(), null);
  ports.admin.getWorkQueue = async () => queue([]);
  c.refresh();
  await settle();
  assert.equal(c.state(), 'ready');
  assert.equal(c.detailState(), 'ready');
  assert.equal(c.selected(), null);
});

for (const status of [401, 403]) {
  for (const surface of [
    'queue',
    'detail',
    'draft',
    'summary',
    'conversation',
    'question'
  ]) {
    test(`${surface} ${status} denial removes every private surface and preserves the forbidden drawer`, async (t) => {
      const { controller: c, ports, calls } = fixture(t);
      await populate(c);
      const fail = async () => {
        throw new AdminDashboardRequestError(status);
      };
      if (surface === 'queue') {
        ports.admin.getWorkQueue = fail;
        await c.load();
      } else if (surface === 'detail') {
        ports.admin.getWorkQueue = (token, input) =>
          input.itemId ? fail() : Promise.resolve(queue());
        c.refresh();
        await settle();
      } else if (surface === 'draft') {
        ports.admin.prepareAssistantDraft = fail;
        await c.prepare(c.selected());
      } else if (surface === 'summary') {
        ports.admin.getAssistantSummary = fail;
        c.summaryState.set('error');
        await c.loadSummary(true);
      } else if (surface === 'conversation') {
        ports.admin.getAssistantContext = fail;
        c.conversationState.set('error');
        await c.loadConversation(true);
      } else {
        ports.admin.queryAssistant = fail;
        await c.ask();
      }
      assertPrivateCleared(c);
      assert.equal(c.selectedId(), 'synthetic-a');
      assert.equal(c.state(), 'forbidden');
      assert.equal(c.detailState(), 'forbidden');
      assert.equal(calls.expired, status === 401 ? 1 : 0);
    });
  }

  for (const outcome of ['resolve', 'reject']) {
    test(`summary, conversation and question ${outcome} after ${status} cannot restore private data`, async (t) => {
      const { controller: c, ports, calls } = fixture(t);
      await select(c);
      await c.loadConversation(true);
      const pending = [deferred(), deferred(), deferred()];
      ports.admin.getAssistantSummary = () => pending[0].promise;
      ports.admin.getAssistantContext = () => pending[1].promise;
      ports.admin.queryAssistant = () => pending[2].promise;
      c.conversationState.set('error');
      c.question.set('Synthetic private question');
      const reads = [c.loadSummary(true), c.loadConversation(true), c.ask()];
      ports.admin.getWorkQueue = async () => {
        throw new AdminDashboardRequestError(status);
      };
      await c.load();
      const states = [c.summaryState(), c.conversationState(), c.answerState()];
      pending.forEach((read, index) => {
        if (outcome === 'resolve')
          read.resolve([summary, context, answer][index]);
        else read.reject(new AdminDashboardRequestError(401));
      });
      await Promise.all(reads);
      assertPrivateCleared(c);
      assert.deepEqual(
        [c.summaryState(), c.conversationState(), c.answerState()],
        states
      );
      assert.equal(calls.expired, status === 401 ? 1 : 0);
    });
  }
}

for (const outcome of ['resolve', 'reject']) {
  test(`disposal clears cached and pending private data, ignores late ${outcome} and suppresses future operations`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    await populate(c);
    const pending = Array.from({ length: 6 }, deferred);
    ports.admin.getWorkQueue = (token, input) =>
      input.itemId ? pending[1].promise : pending[0].promise;
    ports.admin.prepareAssistantDraft = () => pending[2].promise;
    ports.admin.getAssistantSummary = () => pending[3].promise;
    ports.admin.getAssistantContext = () => pending[4].promise;
    ports.admin.queryAssistant = () => pending[5].promise;
    const preparing = c.prepare(c.selected());
    c.summaryState.set('error');
    c.conversationState.set('error');
    const reads = [
      preparing,
      c.loadSummary(true),
      c.loadConversation(true),
      c.ask()
    ];
    c.refresh();
    c.dispose();
    assertPrivateCleared(c);
    assert.equal(c.selectedId(), null);
    assert.deepEqual(c.query(), {});
    pending.forEach((read, index) => {
      if (outcome === 'resolve')
        read.resolve(
          [queue(), queue(), draft, summary, context, answer][index]
        );
      else read.reject(new AdminDashboardRequestError(401));
    });
    await Promise.all(reads);
    await settle();
    ports.admin.getWorkQueue = async (token, input) => {
      calls.queue.push({ token, input });
      return queue();
    };
    const counts = JSON.stringify(calls);
    c.setOverview(query, 'synthetic-b');
    c.leaveOverview();
    c.refresh();
    await c.load();
    await c.prepare(item());
    await c.loadSummary(true);
    await c.loadConversation(true);
    await c.ask();
    assertPrivateCleared(c);
    assert.equal(c.state(), 'idle');
    assert.equal(c.detailState(), 'idle');
    assert.equal(calls.expired, 0);
    assert.equal(JSON.stringify(calls), counts);
  });
}
