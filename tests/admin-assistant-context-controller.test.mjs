import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import {
  AdminAssistantContextController,
  AssistantContextNavigation
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-assistant/admin-assistant-context-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const at = '2026-09-16T14:00:00Z';
const id = 'synthetic-dossier-a';
const secondId = 'synthetic-dossier-b';
const version = 'a'.repeat(64);
const context = (contributionId = id, contextVersion = version) => ({
  status: 'ok',
  generatedAt: at,
  conversationMode: 'mock',
  context: {
    contributionId,
    reference: contributionId,
    version: contextVersion,
    paymentStatus: 'paid',
    refundStatus: 'not_requested',
    reviewStatus: 'pending_review',
    feedStatus: 'not_planned',
    publicConsent: false,
    missingFields: ['photo_presentation'],
    media: { total: 1, approved: 1, pending: 0, rejected: 0 },
    promisedChannels: ['facebook'],
    coveredChannels: [],
    nextStep: 'complete_information',
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}`,
    canRequestInformation: true
  }
});
const proposal = {
  status: 'ok',
  message: null,
  draft: {
    type: 'sponsorship_reminder',
    title: 'Synthetic private draft',
    generatedAt: at,
    reference: id,
    sent: false,
    published: false,
    persisted: false,
    fields: [],
    bodyLines: ['Synthetic private body'],
    notice: 'No delivery.',
    limitations: []
  },
  delivery: {
    contributionId: id,
    contextVersion: version,
    recipient: 'synthetic@example.invalid',
    subject: 'Synthetic subject',
    body: 'Synthetic body'
  }
};
const answer = {
  status: 'ok',
  mode: 'mock',
  enabled: true,
  generatedAt: at,
  provider: { name: 'fixture', model: null },
  toolInvocations: [],
  links: [],
  answer: [
    { kind: 'facts', title: 'Synthetic answer', lines: ['Private facts'] }
  ],
  limitations: []
};
const commandId = '10000000-0000-4000-8000-000000000901';
const delivery = {
  status: 'queued',
  messageId: '10000000-0000-4000-8000-000000000902',
  requestId: commandId,
  acceptedAt: '2026-09-16T14:00:00.000Z',
  deliveryStatus: 'queued',
  sentAt: null
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

function fixture(storage = new Map()) {
  const calls = {
    context: [],
    prepare: [],
    query: [],
    send: [],
    receipts: [],
    effects: []
  };
  const options = {
    sponsorshipId: id,
    validSession: true,
    canPrepare: signal(true),
    sessionGeneration: signal(1),
    identityId: signal('synthetic-admin'),
    language: 'fr-CA',
    destroyed: false
  };
  const ports = {
    newRequestId: () => commandId,
    getInformationRequestReceipt: async (token, input) => {
      calls.receipts.push({ token, input });
      return { ...input, found: false };
    },
    sponsorshipId: () => options.sponsorshipId,
    hasValidSession: () => options.validSession,
    token: () => 'synthetic-session',
    canPrepare: () => options.canPrepare(),
    sessionGeneration: () => options.sessionGeneration(),
    identityId: () => options.identityId(),
    isDestroyed: () => options.destroyed,
    language: () => options.language,
    getAssistantContext: async (token, dossierId) => {
      calls.context.push({ token, dossierId });
      return context(dossierId);
    },
    prepareAssistantDraft: async (token, input) => {
      calls.prepare.push({ token, input });
      return proposal;
    },
    queryAssistant: async (token, input) => {
      calls.query.push({ token, input });
      return answer;
    },
    requestSponsorshipInformation: async (token, input) => {
      calls.send.push({ token, input });
      calls.effects.push('request');
      return delivery;
    },
    refreshWorkQueue: async () => {
      calls.effects.push('refresh');
    },
    onUnauthorized: async () => {
      calls.effects.push('unauthorized');
    },
    closeConfirmation: () => calls.effects.push('close'),
    openConfirmation: () => calls.effects.push('open'),
    storage: () => ({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    })
  };
  const controller = new AdminAssistantContextController(ports);
  return { controller, ports, calls, options, storage };
}

async function populate(c) {
  await c.load();
  await c.prepare('sponsorship_reminder');
  c.subject.set('Private edited subject');
  c.body.set('Private edited body');
  c.question.set('Private edited question');
  await c.ask();
}

function assertPrivateCleared(c) {
  for (const field of [
    'data',
    'prepared',
    'answer',
    'delivery',
    'confirmation'
  ])
    assert.equal(c[field](), null, field);
  for (const field of ['subject', 'body', 'question'])
    assert.equal(c[field](), '', field);
  assert.equal(c.snapshot(), null);
}

async function uncertainRequest(f) {
  await populate(f.controller);
  const send = f.ports.requestSponsorshipInformation;
  f.ports.requestSponsorshipInformation = async (...args) => {
    await send(...args);
    throw new Error('Synthetic response lost');
  };
  f.controller.reviewSend();
  const input = f.controller.confirmation();
  await f.controller.send();
  return input;
}
const recoveredReceipt = (deliveryStatus = 'queued') => ({
  ...delivery,
  contributionId: id,
  found: true,
  deliveryStatus,
  sentAt: deliveryStatus === 'sent' ? delivery.acceptedAt : null
});

for (const status of ['queued', 'sent', 'failed']) {
  test(`matching ${status} information receipt resolves only the retained command without another POST`, async () => {
    const f = fixture(),
      c = f.controller;
    const input = await uncertainRequest(f);
    const get = f.ports.getInformationRequestReceipt;
    f.ports.getInformationRequestReceipt = async (...args) => {
      await get(...args);
      return recoveredReceipt(status);
    };
    assert.equal(await c.verifyInformationReceipt(), true);
    assert.equal(c.informationUncertain(), false);
    assert.equal(c.informationReceipt().messageId, delivery.messageId);
    assert.equal(c.informationReceipt().deliveryStatus, status);
    assert.equal(f.storage.size, 0);
    assert.deepEqual(f.calls.receipts, [
      {
        token: 'synthetic-session',
        input: { requestId: input.requestId, contributionId: id }
      }
    ]);
    assert.equal(f.calls.send.length, 1);
  });
}

test('sending and uncertain receipts keep the exact UUID through reload until a definitive receipt', async () => {
  const f = fixture();
  await uncertainRequest(f);
  f.ports.getInformationRequestReceipt = async () =>
    recoveredReceipt('sending');
  assert.equal(await f.controller.verifyInformationReceipt(), true);
  assert.equal(f.controller.informationUncertain(), true);
  const next = fixture(f.storage),
    c = next.controller;
  await c.load();
  assert.deepEqual(c.receiptRequest(), {
    requestId: commandId,
    contributionId: id
  });
  next.ports.getInformationRequestReceipt = async () =>
    recoveredReceipt('uncertain');
  await c.verifyInformationReceipt();
  assert.equal(c.informationUncertain(), true);
  next.ports.getInformationRequestReceipt = async () =>
    recoveredReceipt('sent');
  await c.verifyInformationReceipt();
  assert.equal(c.informationUncertain(), false);
  assert.equal(next.storage.size, 0);
  assert.equal(f.calls.send.length, 1);
  assert.equal(next.calls.send.length, 0);
});

for (const [name, value] of [
  ['absent', { requestId: commandId, contributionId: id, found: false }],
  ['unavailable', new AdminDashboardRequestError(503)],
  ['wrong request', { ...recoveredReceipt(), requestId: delivery.messageId }],
  ['wrong dossier', { ...recoveredReceipt(), contributionId: secondId }],
  ['truthy found', { ...recoveredReceipt(), found: 'true' }],
  ['missing found', { ...recoveredReceipt(), found: undefined }],
  ['numeric message', { ...recoveredReceipt(), messageId: 123 }],
  ['invalid message', { ...recoveredReceipt(), messageId: 'not-a-uuid' }],
  ['missing accepted date', { ...recoveredReceipt(), acceptedAt: undefined }],
  ['permissive date', { ...recoveredReceipt(), acceptedAt: '2026-09-16' }],
  [
    'invalid calendar',
    { ...recoveredReceipt(), acceptedAt: '2026-02-30T14:00:00.000Z' }
  ],
  ['noncanonical accepted date', { ...recoveredReceipt(), acceptedAt: at }],
  ['numeric sent date', { ...recoveredReceipt(), sentAt: 123 }],
  ['noncanonical sent date', { ...recoveredReceipt(), sentAt: at }],
  ['unknown delivery', { ...recoveredReceipt(), deliveryStatus: 'delivered' }]
])
  test(`${name} receipt preserves the UUID and blocks any new information command`, async () => {
    const f = fixture(),
      c = f.controller;
    await uncertainRequest(f);
    f.ports.getInformationRequestReceipt = async () => {
      if (value instanceof Error) throw value;
      return value;
    };
    assert.equal(await c.verifyInformationReceipt(), false);
    assert.equal(c.informationUncertain(), true);
    assert.equal(c.informationReceipt(), null);
    assert.equal(
      c.receiptState(),
      name === 'absent' ? 'notFound' : 'unavailable'
    );
    assert.equal([...f.storage.values()][0], commandId);
    await c.prepare('sponsorship_reminder');
    c.reviewSend();
    await c.send();
    assert.equal(f.calls.send.length, 1);
  });

test('legacy pending state stays blocked without generating a UUID or looking up a guessed receipt', async () => {
  const f = fixture(
    new Map([['openg7-assistant-information-pending:' + id, 'pending']])
  );
  f.ports.newRequestId = () => {
    throw new Error('Must not generate');
  };
  await f.controller.load();
  assert.equal(f.controller.informationUncertain(), true);
  assert.equal(f.controller.receiptRequest(), null);
  await f.controller.verifyInformationReceipt();
  assert.equal(f.calls.receipts.length, 0);
  assert.equal(f.calls.send.length, 0);
  assert.equal([...f.storage.values()][0], 'pending');
});

for (const change of ['dossier', 'session', 'identity', 'role', 'destroyed'])
  test(`late receipt cannot apply after ${change} changed`, async () => {
    const f = fixture(),
      c = f.controller,
      held = deferred();
    await uncertainRequest(f);
    f.ports.getInformationRequestReceipt = () => held.promise;
    const verifying = c.verifyInformationReceipt();
    if (change === 'dossier') f.options.sponsorshipId = secondId;
    if (change === 'session') f.options.sessionGeneration.set(2);
    if (change === 'identity') f.options.identityId.set('other-admin');
    if (change === 'role') f.options.canPrepare.set(false);
    if (change === 'destroyed') f.options.destroyed = true;
    if (change !== 'destroyed') await c.load();
    held.resolve(recoveredReceipt());
    assert.equal(await verifying, false);
    assert.equal(c.informationReceipt(), null);
    assert.equal([...f.storage.values()][0], commandId);
    assert.equal(f.calls.effects.includes('refresh'), false);
    assert.equal(f.calls.send.length, 1);
  });

test('an older POST completion cannot remove a newer retained UUID', async () => {
  const f = fixture(),
    c = f.controller,
    held = deferred();
  await populate(c);
  f.ports.requestSponsorshipInformation = () => held.promise;
  c.reviewSend();
  const sending = c.send();
  f.storage.set(
    'openg7-assistant-information-pending:' + id,
    delivery.messageId
  );
  held.resolve(delivery);
  await sending;
  assert.equal([...f.storage.values()][0], delivery.messageId);
  assert.equal(c.informationUncertain(), true);
});

test('a missing secure UUID prevents confirmation and POST', async () => {
  const f = fixture();
  await populate(f.controller);
  f.ports.newRequestId = () => null;
  f.controller.reviewSend();
  await f.controller.send();
  assert.equal(f.controller.confirmation(), null);
  assert.equal(f.controller.error(), 'actionError');
  assert.equal(f.calls.send.length, 0);
});

test('a UUID ownership conflict retains the exact verifiable command instead of permitting another send', async () => {
  const f = fixture(),
    c = f.controller;
  await populate(c);
  f.ports.requestSponsorshipInformation = async () => {
    throw new AdminDashboardRequestError(
      409,
      'Synthetic conflict',
      'INFORMATION_REQUEST_ID_CONFLICT'
    );
  };
  c.reviewSend();
  await c.send();
  assert.equal(c.error(), 'conflict');
  assert.equal(c.informationUncertain(), true);
  assert.equal(c.canVerifyReceipt(), true);
  assert.equal(c.receiptRequest().requestId, commandId);
  assert.equal([...f.storage.values()][0], commandId);
});

test('exact dossier loading clears previous private state and retries an unavailable read', async () => {
  const { controller: c, ports, calls, options } = fixture();
  await populate(c);
  c.reviewSend();
  ports.getAssistantContext = async () => {
    throw new AdminDashboardRequestError(503);
  };
  const failed = c.load();
  assert.equal(c.state(), 'loading');
  assertPrivateCleared(c);
  await failed;
  assert.equal(c.state(), 'error');
  assert.equal(c.error(), '');
  options.sponsorshipId = secondId;
  ports.getAssistantContext = async (token, dossierId) => {
    calls.context.push({ token, dossierId });
    return context(dossierId);
  };
  await c.load();
  assert.equal(c.state(), 'ready');
  assert.equal(c.data().context.contributionId, secondId);
  assert.deepEqual(calls.context.at(-1), {
    token: 'synthetic-session',
    dossierId: secondId
  });
});

test('empty context remains readable without permitting preparation or questions', async () => {
  const { controller: c, ports, calls } = fixture();
  ports.getAssistantContext = async () => ({
    ...context(),
    status: 'empty',
    context: null
  });
  await c.load();
  c.question.set('Synthetic question');
  await c.ask();
  await c.prepare('admin_note');
  assert.equal(c.state(), 'ready');
  assert.deepEqual(calls.query, []);
  assert.deepEqual(calls.prepare, []);
  assert.equal(c.snapshot(), null);
});

for (const status of [401, 403]) {
  test(`read ${status} removes all private state and only 401 redirects`, async () => {
    const { controller: c, ports, calls } = fixture();
    await populate(c);
    c.reviewSend();
    ports.getAssistantContext = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await c.load();
    assertPrivateCleared(c);
    assert.equal(c.state(), 'forbidden');
    assert.equal(calls.effects.includes('unauthorized'), status === 401);
  });
}

test('an absent session is rejected before any context request', async () => {
  const { controller: c, options, calls } = fixture();
  options.validSession = false;
  await c.load();
  assert.equal(c.state(), 'forbidden');
  assert.deepEqual(calls.context, []);
  assert.deepEqual(calls.effects, ['close', 'close', 'unauthorized']);
});

test('preparation captures exact dossier and language, blocks concurrent actions and sends nothing', async () => {
  const { controller: c, ports, calls, options } = fixture();
  await c.load();
  options.language = 'en';
  const held = deferred();
  const prepare = ports.prepareAssistantDraft;
  ports.prepareAssistantDraft = async (...args) => {
    await prepare(...args);
    return held.promise;
  };
  const pending = c.prepare('sponsorship_reminder');
  assert.equal(c.busy(), true);
  c.question.set('Synthetic question');
  await c.prepare('admin_note');
  await c.ask();
  c.reviewSend();
  await c.send();
  assert.deepEqual(calls.prepare, [
    {
      token: 'synthetic-session',
      input: { type: 'sponsorship_reminder', reference: id, language: 'en' }
    }
  ]);
  assert.deepEqual(calls.query, []);
  assert.deepEqual(calls.send, []);
  held.resolve(proposal);
  await pending;
  assert.equal(c.busy(), false);
  assert.equal(c.prepared(), proposal);
  assert.equal(c.subject(), proposal.delivery.subject);
  assert.equal(c.body(), proposal.delivery.body);
  assert.equal(c.confirmation(), null);
});

test('reader can ask scoped questions but cannot prepare, review or send; disabled conversation does not query', async () => {
  const { controller: c, options, ports, calls } = fixture();
  options.canPrepare.set(false);
  await c.load();
  c.question.set('   ');
  await c.ask();
  c.question.set('  Synthetic question  ');
  await c.ask();
  await c.prepare('sponsorship_reminder');
  c.prepared.set(proposal);
  c.subject.set('Subject');
  c.body.set('Body');
  c.reviewSend();
  await c.send();
  assert.deepEqual(calls.query, [
    {
      token: 'synthetic-session',
      input: { message: 'Synthetic question', sponsorshipId: id }
    }
  ]);
  assert.equal(c.answer(), answer);
  assert.deepEqual(calls.prepare, []);
  assert.deepEqual(calls.send, []);
  assert.equal(c.confirmation(), null);
  ports.getAssistantContext = async () => ({
    ...context(),
    conversationMode: 'disabled'
  });
  await c.load();
  c.question.set('Synthetic question');
  await c.ask();
  assert.equal(calls.query.length, 1);
});

test('delivery requires reviewed confirmation, preserves edits on cancel and refreshes only after server success', async () => {
  const { controller: c, ports, calls } = fixture();
  await c.load();
  await c.send();
  await c.prepare('sponsorship_reminder');
  c.subject.set('   ');
  c.reviewSend();
  assert.equal(c.confirmation(), null);
  c.subject.set('  Private edited subject  ');
  c.body.set('  Private edited body  ');
  c.reviewSend();
  assert.deepEqual(c.confirmation(), {
    ...proposal.delivery,
    requestId: commandId,
    subject: 'Private edited subject',
    body: 'Private edited body',
    confirmed: true
  });
  c.cancelSend();
  await c.send();
  assert.equal(c.subject(), '  Private edited subject  ');
  assert.equal(c.body(), '  Private edited body  ');
  assert.equal(calls.send.length, 0);
  c.reviewSend();
  const held = deferred();
  const request = ports.requestSponsorshipInformation;
  ports.requestSponsorshipInformation = async (...args) => {
    await request(...args);
    return held.promise;
  };
  const sending = c.send();
  await c.send();
  assert.equal(c.confirmation(), null);
  assert.equal(c.delivery(), null);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.effects.includes('refresh'), false);
  assert.deepEqual(calls.effects.slice(-2), ['close', 'request']);
  assert.equal(calls.send[0].input.contextVersion, version);
  assert.equal(calls.send[0].input.recipient, 'synthetic@example.invalid');
  held.resolve(delivery);
  await sending;
  assert.equal(c.delivery(), delivery);
  assert.equal(c.prepared(), null);
  assert.equal(c.subject(), '');
  assert.equal(c.body(), '');
  assert.equal(calls.effects.at(-1), 'refresh');
});

test('a definitive refused send preserves the draft and requires a new confirmation', async () => {
  const { controller: c, ports, calls } = fixture();
  await populate(c);
  const request = ports.requestSponsorshipInformation;
  ports.requestSponsorshipInformation = async () => {
    throw new AdminDashboardRequestError(400);
  };
  c.reviewSend();
  await c.send();
  assert.equal(c.error(), 'actionError');
  assert.equal(c.busy(), false);
  assert.equal(c.confirmation(), null);
  assert.equal(c.prepared(), proposal);
  assert.equal(c.body(), 'Private edited body');
  await c.send();
  assert.equal(calls.effects.includes('refresh'), false);
  ports.requestSponsorshipInformation = request;
  c.reviewSend();
  await c.send();
  assert.equal(c.error(), '');
  assert.equal(c.delivery(), delivery);
  assert.equal(calls.send.length, 1);
});

for (const failure of [
  new Error('Synthetic request response lost'),
  new AdminDashboardRequestError(408),
  new AdminDashboardRequestError(503)
]) {
  test(`an information request with ${failure.message} retains its exact payload and prevents a changed resend`, async () => {
    const { controller: c, ports, calls } = fixture();
    await populate(c);
    const sent = [];
    ports.requestSponsorshipInformation = async (token, input) => {
      sent.push(structuredClone(input));
      throw failure;
    };
    c.reviewSend();
    const input = c.confirmation();
    await c.send();
    assert.deepEqual(c.uncertainInformation(), input);
    assert.equal(c.canPrepare(), false);
    assert.equal(c.busy(), false);
    assert.equal(c.delivery(), null);
    c.subject.set('Different subject cannot create another logical request');
    c.body.set('Different body cannot create another logical request');
    c.reviewSend();
    await c.send();
    await c.prepare('sponsorship_reminder');
    assert.deepEqual(sent, [input]);
    assert.equal(c.confirmation(), null);
    assert.equal(calls.prepare.length, 1);
    assert.equal(calls.effects.includes('refresh'), false);
    await c.load();
    assert.deepEqual(c.uncertainInformation(), input);
    assert.equal(c.canPrepare(), false);
    assert.equal(c.subject(), input.subject);
    assert.equal(c.body(), input.body);
    await c.send();
    assert.equal(sent.length, 1);
  });
}

test('an uncertain information request survives the one-use handoff even when the dossier version changes', async () => {
  const { controller: source, ports } = fixture();
  await populate(source);
  ports.requestSponsorshipInformation = async () => {
    throw new Error('Synthetic uncertain mail request');
  };
  source.reviewSend();
  await source.send();
  const { controller: destination, ports: nextPorts, calls } = fixture();
  nextPorts.getAssistantContext = async () => context(id, 'b'.repeat(64));
  await destination.load(source.snapshot());
  assert.deepEqual(
    destination.uncertainInformation(),
    source.uncertainInformation()
  );
  assert.equal(destination.canPrepare(), false);
  await destination.prepare('sponsorship_reminder');
  destination.reviewSend();
  await destination.send();
  assert.deepEqual(calls.send, []);
  assert.deepEqual(calls.prepare, []);
});

test('uncertain private mail state is removed when the session changes', async () => {
  const { controller: c, ports, options } = fixture();
  await populate(c);
  ports.requestSponsorshipInformation = async () => {
    throw new Error('Synthetic old-session uncertainty');
  };
  c.reviewSend();
  await c.send();
  options.sessionGeneration.set(2);
  await c.load();
  assert.equal(c.uncertainInformation(), null);
  assert.equal(c.subject(), '');
  assert.equal(c.body(), '');
  assert.equal(c.informationUncertain(), true);
  assert.equal(c.canPrepare(), false);
});

test('a new controller keeps an opaque uncertain marker without persisting the private request or sending again', async () => {
  const first = fixture();
  await populate(first.controller);
  first.ports.requestSponsorshipInformation = async () => {
    throw new Error('Synthetic disconnected response');
  };
  first.controller.reviewSend();
  await first.controller.send();
  assert.deepEqual(
    [...first.storage],
    [['openg7-assistant-information-pending:' + id, commandId]]
  );
  const stored = JSON.stringify([...first.storage]);
  assert.equal(stored.includes('@'), false);
  assert.equal(stored.includes('Private edited'), false);
  const next = fixture(first.storage);
  await next.controller.load();
  assert.equal(next.controller.uncertainInformation(), null);
  assert.equal(next.controller.informationUncertain(), true);
  assert.equal(next.controller.canPrepare(), false);
  await next.controller.prepare('sponsorship_reminder');
  next.controller.reviewSend();
  await next.controller.send();
  assert.deepEqual(next.calls.prepare, []);
  assert.deepEqual(next.calls.send, []);
});

test('a definitive information response removes its opaque marker', async () => {
  for (const outcome of ['queued', 'refused']) {
    const { controller: c, ports, storage } = fixture();
    await populate(c);
    if (outcome === 'refused')
      ports.requestSponsorshipInformation = async () => {
        throw new AdminDashboardRequestError(400);
      };
    c.reviewSend();
    await c.send();
    assert.equal(storage.size, 0);
    assert.equal(c.informationUncertain(), false);
  }
});

test('a version conflict invalidates the draft and permits preparation again without claiming delivery', async () => {
  const { controller: c, ports, calls } = fixture();
  await populate(c);
  ports.requestSponsorshipInformation = async () => {
    throw new AdminDashboardRequestError(409);
  };
  c.reviewSend();
  await c.send();
  assert.equal(c.error(), 'conflict');
  assert.equal(c.prepared(), null);
  assert.equal(c.delivery(), null);
  assert.equal(c.data().context.contributionId, id);
  assert.equal(calls.effects.includes('refresh'), false);
  c.reviewSend();
  assert.equal(c.confirmation(), null);
  await c.prepare('sponsorship_reminder');
  assert.equal(c.error(), '');
  assert.equal(c.prepared(), proposal);
});

test('a server-selected cockpit dossier releases only its refused information request and exposes the conflict', async () => {
  const { controller: c, ports, options, storage } = fixture();
  options.sponsorshipId = undefined;
  await populate(c);
  ports.requestSponsorshipInformation = async () => {
    throw new AdminDashboardRequestError(409);
  };
  c.reviewSend();
  await c.send();
  assert.equal(c.data().context.contributionId, id);
  assert.equal(c.uncertainInformation(), null);
  assert.equal(c.informationUncertain(), false);
  assert.equal(c.error(), 'conflict');
  assert.equal(c.prepared(), null);
  assert.equal(storage.size, 0);
});

test('401 during an action erases private fields and confirmation before redirecting', async () => {
  const { controller: c, ports } = fixture();
  await populate(c);
  c.reviewSend();
  c.delivery.set(delivery);
  ports.prepareAssistantDraft = async () => {
    throw new AdminDashboardRequestError(401);
  };
  let redirected = false;
  ports.onUnauthorized = async () => {
    assertPrivateCleared(c);
    redirected = true;
  };
  await c.prepare('admin_note');
  assertPrivateCleared(c);
  assert.equal(c.state(), 'forbidden');
  assert.equal(c.busy(), false);
  assert.equal(redirected, true);
});

for (const readStatus of [200, 403, 401, 503]) {
  test(`403 action rechecks permission before retaining dossier facts (read ${readStatus})`, async () => {
    const { controller: c, ports, calls } = fixture();
    await populate(c);
    ports.prepareAssistantDraft = async () => {
      throw new AdminDashboardRequestError(403);
    };
    const held = deferred();
    ports.getAssistantContext = () => held.promise;
    const pending = c.prepare('admin_note');
    await settle();
    assertPrivateCleared(c);
    assert.equal(c.state(), 'loading');
    if (readStatus === 200) held.resolve(context());
    else held.reject(new AdminDashboardRequestError(readStatus));
    await pending;
    if (readStatus === 200) {
      assert.equal(c.state(), 'ready');
      assert.equal(c.data().context.contributionId, id);
      assert.equal(c.error(), 'actionForbidden');
      assert.equal(c.prepared(), null);
      assert.equal(c.question(), '');
    } else {
      assertPrivateCleared(c);
      assert.equal(c.state(), readStatus === 503 ? 'error' : 'forbidden');
      assert.equal(c.error(), '');
    }
    assert.equal(calls.effects.includes('unauthorized'), readStatus === 401);
  });
}

test('the navigation handoff is consumed once and restores only admissible private state', async () => {
  const { controller: source } = fixture();
  await populate(source);
  source.reviewSend();
  source.delivery.set(delivery);
  const snapshot = source.snapshot();
  const navigation = new AssistantContextNavigation(snapshot);
  const { controller: destination, calls } = fixture();
  await destination.load(navigation.take());
  assert.equal(navigation.take(), null);
  assert.equal(destination.prepared(), proposal);
  assert.equal(destination.answer(), answer);
  assert.equal(destination.subject(), 'Private edited subject');
  assert.equal(destination.body(), 'Private edited body');
  assert.equal(destination.question(), 'Private edited question');
  assert.equal(destination.confirmation(), null);
  assert.equal(destination.delivery(), null);
  assert.deepEqual(calls.prepare, []);
  assert.deepEqual(calls.query, []);
  assert.deepEqual(calls.send, []);
  await destination.load(navigation.take());
  assert.equal(destination.prepared(), null);
  assert.equal(destination.answer(), null);
  assert.equal(destination.question(), '');
});

for (const mismatch of ['dossier', 'session', 'identity']) {
  test(`navigation cannot restore private edits with a different ${mismatch}`, async () => {
    const { controller: source } = fixture();
    await populate(source);
    const snapshot = source.snapshot();
    const { controller: c, options } = fixture();
    if (mismatch === 'dossier') options.sponsorshipId = secondId;
    if (mismatch === 'session') options.sessionGeneration.set(2);
    if (mismatch === 'identity') options.identityId.set('another-admin');
    await c.load(snapshot);
    assert.equal(c.prepared(), null);
    assert.equal(c.answer(), null);
    assert.equal(c.subject(), '');
    assert.equal(c.body(), '');
    assert.equal(c.question(), '');
  });
}

test('a changed version restores only the question and reports a discarded draft', async () => {
  const { controller: source } = fixture();
  await populate(source);
  const { controller: c, ports } = fixture();
  ports.getAssistantContext = async () => context(id, 'b'.repeat(64));
  await c.load(source.snapshot());
  assert.equal(c.question(), 'Private edited question');
  assert.equal(c.prepared(), null);
  assert.equal(c.answer(), null);
  assert.equal(c.subject(), '');
  assert.equal(c.body(), '');
  assert.equal(c.error(), 'conflict');
  await c.load({ ...source.snapshot(), prepared: null });
  assert.equal(c.error(), '');
});

test('a matching reader navigation restores question and answer without a private draft', async () => {
  const { controller: source } = fixture();
  await populate(source);
  const { controller: c, options } = fixture();
  options.canPrepare.set(false);
  await c.load(source.snapshot());
  assert.equal(c.question(), 'Private edited question');
  assert.equal(c.answer(), answer);
  assert.equal(c.prepared(), null);
  assert.equal(c.subject(), '');
  assert.equal(c.body(), '');
});

for (const outcome of ['resolve', 'reject']) {
  for (const obsolete of ['target', 'destroyed']) {
    test(`an obsolete context ${outcome} after ${obsolete} cannot alter private state or redirect`, async () => {
      const { controller: c, ports, options, calls } = fixture();
      const held = deferred();
      ports.getAssistantContext = () => held.promise;
      const old = c.load();
      if (obsolete === 'target') {
        options.sponsorshipId = secondId;
        ports.getAssistantContext = async () => context(secondId);
        await c.load();
      } else options.destroyed = true;
      if (outcome === 'resolve') held.resolve(context());
      else held.reject(new AdminDashboardRequestError(401));
      await old;
      assert.equal(
        c.data()?.context.contributionId,
        obsolete === 'target' ? secondId : undefined
      );
      assert.equal(c.state(), obsolete === 'target' ? 'ready' : 'loading');
      assert.equal(c.error(), '');
      assert.equal(calls.effects.includes('unauthorized'), false);
    });
  }
}

for (const action of ['prepare', 'ask', 'send']) {
  for (const outcome of ['resolve', 'reject']) {
    for (const obsolete of ['target', 'destroyed']) {
      test(`late ${action} ${outcome} after ${obsolete} cannot replace data, refresh the queue or redirect`, async () => {
        const { controller: c, ports, options, calls } = fixture();
        await populate(c);
        const held = deferred();
        if (action === 'prepare')
          ports.prepareAssistantDraft = () => held.promise;
        if (action === 'ask') ports.queryAssistant = () => held.promise;
        if (action === 'send') {
          ports.requestSponsorshipInformation = () => held.promise;
          c.reviewSend();
        }
        const old =
          action === 'prepare' ? c.prepare('admin_note') : c[action]();
        if (obsolete === 'target') {
          options.sponsorshipId = secondId;
          await c.load();
        } else options.destroyed = true;
        const before = {
          data: c.data(),
          prepared: c.prepared(),
          answer: c.answer(),
          delivery: c.delivery(),
          busy: c.busy(),
          error: c.error()
        };
        if (outcome === 'resolve')
          held.resolve(
            action === 'prepare'
              ? proposal
              : action === 'ask'
                ? answer
                : delivery
          );
        else held.reject(new AdminDashboardRequestError(401));
        await old;
        assert.deepEqual(
          {
            data: c.data(),
            prepared: c.prepared(),
            answer: c.answer(),
            delivery: c.delivery(),
            busy: c.busy(),
            error: c.error()
          },
          before
        );
        assert.equal(calls.effects.includes('unauthorized'), false);
        assert.equal(calls.effects.includes('refresh'), false);
      });
    }
  }
}

test('completion of an old action keeps the new dossier action busy until its own response', async () => {
  const { controller: c, ports, options } = fixture();
  await c.load();
  const first = deferred();
  ports.prepareAssistantDraft = () => first.promise;
  const old = c.prepare('admin_note');
  options.sponsorshipId = secondId;
  await c.load();
  const second = deferred();
  ports.prepareAssistantDraft = () => second.promise;
  const current = c.prepare('admin_note');
  first.resolve(proposal);
  await old;
  assert.equal(c.busy(), true);
  assert.equal(c.prepared(), null);
  second.resolve({ ...proposal, delivery: null });
  await current;
  assert.equal(c.busy(), false);
  assert.equal(c.prepared().delivery, null);
});

test('a delayed 403 recheck cannot apply its error to a new dossier', async () => {
  const { controller: c, ports, options } = fixture();
  await c.load();
  const recheck = deferred();
  ports.prepareAssistantDraft = async () => {
    throw new AdminDashboardRequestError(403);
  };
  ports.getAssistantContext = () => recheck.promise;
  const action = c.prepare('admin_note');
  await settle();
  options.sponsorshipId = secondId;
  ports.getAssistantContext = async () => context(secondId);
  await c.load();
  recheck.resolve(context());
  await action;
  assert.equal(c.data().context.contributionId, secondId);
  assert.equal(c.state(), 'ready');
  assert.equal(c.error(), '');
});
