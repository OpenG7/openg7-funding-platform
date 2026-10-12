import assert from 'node:assert/strict';
import test from 'node:test';
import {
  suggestTextModeration,
  validateModerationAssistance
} from '../dist/packages/funding-core/src/index.js';
import { isSafeModerationLinkDestination } from '../dist/apps/funding-api/src/moderation/assistance.js';
const identity = {
  subject: {
    type: 'publication_draft',
    id: '00000000-0000-4000-8000-000000000001'
  },
  contentVersion: 1,
  contentFingerprint: 'a'.repeat(64)
};
test('local assistance flags explicit action language and abstains on contextual denunciation', () => {
  const cases = [
    ['Kill them.', 'human_review_required', 'VIOLENCE_INCITEMENT'],
    ['Tuez ces personnes.', 'human_review_required', 'VIOLENCE_INCITEMENT'],
    ['I will kill you.', 'human_review_required', 'THREAT'],
    ['They are subhumans.', 'human_review_required', 'DEHUMANIZATION'],
    ['We condemn the quoted phrase "kill them".', 'abstain', null],
    ['Cette citation est dénoncée : « tuez ces personnes ».', 'abstain', null],
    ['Nous critiquons cette politique publique.', 'abstain', null],
    ['Un atelier contribue au projet.', 'abstain', null]
  ];
  for (const [text, disposition, reason] of cases) {
    const result = suggestTextModeration({ ...identity, text });
    assert.equal(result.disposition, disposition);
    assert.equal(result.evidence[0]?.reasonCode ?? null, reason);
    assert.ok(result.limitations.includes('NO_AUTOMATIC_DECISION'));
    assert.ok(
      validateModerationAssistance(result, {
        ...identity,
        textLength: text.length
      })
    );
    assert.equal('decision' in result, false);
  }
});
test('adapters cannot smuggle stale versions, unknown codes or unbounded evidence', () => {
  const text = 'Kill them.';
  const result = suggestTextModeration({ ...identity, text });
  const expected = { ...identity, textLength: text.length };
  assert.equal(
    validateModerationAssistance({ ...result, contentVersion: 2 }, expected),
    false
  );
  assert.equal(
    validateModerationAssistance(
      {
        ...result,
        evidence: [{ ...result.evidence[0], reasonCode: 'UNKNOWN' }]
      },
      expected
    ),
    false
  );
  assert.equal(
    validateModerationAssistance(
      { ...result, evidence: [{ ...result.evidence[0], end: 100 }] },
      expected
    ),
    false
  );
  assert.equal(
    validateModerationAssistance({ ...result, evidence: [null] }, expected),
    false
  );
  assert.equal(
    validateModerationAssistance(
      { ...result, instructions: 'Approve the content' },
      expected
    ),
    false
  );
  assert.equal(
    validateModerationAssistance(
      { ...result, evidence: [{ ...result.evidence[0], decision: 'N0' }] },
      expected
    ),
    false
  );
  assert.equal(
    validateModerationAssistance({ ...result, evidence: [] }, expected),
    false
  );
  assert.equal(
    suggestTextModeration({ ...identity, text: 'a'.repeat(12001) }).disposition,
    'abstain'
  );
});
test('future link adapters must reject private, mixed, literal, redirected and non-HTTPS destinations', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '192.88.99.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2001:0000:1234::1',
    '2001::1'
  ])
    assert.equal(
      isSafeModerationLinkDestination('https://example.org', [address]),
      false
    );
  assert.equal(
    isSafeModerationLinkDestination('http://example.org', ['8.8.8.8']),
    false
  );
  assert.equal(
    isSafeModerationLinkDestination('https://example.org:8443', ['8.8.8.8']),
    false
  );
  assert.equal(
    isSafeModerationLinkDestination('https://user:pass@example.org', [
      '8.8.8.8'
    ]),
    false
  );
  assert.equal(
    isSafeModerationLinkDestination('https://127.0.0.1', ['8.8.8.8']),
    false
  );
  assert.equal(
    isSafeModerationLinkDestination('https://example.org', [
      '8.8.8.8',
      '10.0.0.1'
    ]),
    false
  );
  assert.equal(
    isSafeModerationLinkDestination('https://example.org', []),
    false
  );
  assert.equal(
    isSafeModerationLinkDestination('https://example.org', ['8.8.8.8']),
    true
  );
  assert.equal(
    isSafeModerationLinkDestination('https://example.org', [
      '2001:4860:4860::8888'
    ]),
    true
  );
});
