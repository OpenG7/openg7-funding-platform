import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ControllerInput,
  defaultControllerProfile,
  normalizeControllerSample,
  validControllerProfile
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-pilotage/controller-input.js';
import { parsePilotCommand } from '../dist/apps/funding-api/src/admin-pilotage.service.js';

const profile = defaultControllerProfile();
const sample = (buttons = [], axes = []) => ({
  connected: true,
  mapping: 'standard',
  buttons: Array.from({ length: 17 }, (_, i) => (buttons.includes(i) ? 1 : 0)),
  axes
});
test('holding an action through arrival, modal change or reconnection cannot approve', () => {
  const input = new ControllerInput();
  assert.deepEqual(input.read(sample([0]), 0, profile), []);
  input.read(sample(), 1, profile);
  assert.deepEqual(input.read(sample([0]), 2, profile), ['primary']);
  assert.deepEqual(input.read(sample([0]), 5000, profile), []);
  input.reset();
  assert.deepEqual(input.read(sample([0]), 5001, profile), []);
  input.read(sample(), 5002, profile);
  assert.deepEqual(input.read(sample([0]), 5003, profile), ['primary']);
  input.read(null, 5004, profile);
  assert.deepEqual(input.read(sample([0]), 5005, profile), []);
});
test('chords suppress individual buttons and require neutral after modifier release', () => {
  const input = new ControllerInput();
  input.read(sample(), 0, profile);
  assert.deepEqual(input.read(sample([6, 3]), 1, profile), ['calendar']);
  assert.deepEqual(input.read(sample([3]), 2, profile), []);
  assert.deepEqual(input.read(sample([3]), 3000, profile), []);
  input.read(sample(), 3001, profile);
  assert.deepEqual(input.read(sample([3]), 3002, profile), ['details']);
  input.reset();
  input.read(sample(), 3003, profile);
  assert.deepEqual(input.read(sample([0, 1]), 3004, profile), []);
});
test('navigation repeats after delay, drift does not arm and unknown layouts remain inert', () => {
  const input = new ControllerInput();
  input.read(sample([], [0.1, 0]), 0, profile);
  assert.deepEqual(input.read(sample([5]), 1, profile), ['next']);
  assert.deepEqual(input.read(sample([5]), 100, profile), []);
  assert.deepEqual(input.read(sample([5]), 401, profile), ['next']);
  assert.deepEqual(
    input.read({ ...sample([0]), mapping: '' }, 402, profile),
    []
  );
  input.reset();
  assert.deepEqual(input.read(sample([], [0.6, 0]), 403, profile), []);
  assert.equal(
    validControllerProfile({
      ...profile,
      bindings: { ...profile.bindings, primary: 1 }
    }),
    false
  );
  assert.equal(
    validControllerProfile({ ...profile, deadzone: Infinity }),
    false
  );
});
test('closed command catalog rejects malformed sponsors, missing confirmation and arbitrary financial actions', () => {
  const c = {
    requestId: '11111111-1111-4111-8111-111111111111',
    targetId: '22222222-2222-4222-8222-222222222222',
    version: '1',
    action: 'publication.approve',
    confirmation: '22222222-2222-4222-8222-222222222222'
  };
  assert.equal(parsePilotCommand(c).action, 'publication.approve');
  for (const bad of [
    { ...c, action: 'refund' },
    { ...c, confirmation: '' },
    { ...c, payload: { approveSponsors: {} } },
    { ...c, payload: { approveSponsors: [null] } },
    { ...c, payload: { unexpected: true } }
  ])
    assert.throws(() => parsePilotCommand(bad), { code: 'INVALID_COMMAND' });
});
test('nonstandard calibration is bound to its device and normalizes axes and buttons', () => {
  const p = {
    ...defaultControllerProfile(),
    calibrated: true,
    deviceId: 'fixture'
  };
  [p.rawButtons[0], p.rawButtons[1]] = [p.rawButtons[1], p.rawButtons[0]];
  p.rawAxes[1].sign = -1;
  const raw = { ...sample([1], [0, -1, 0, 0]), mapping: '' };
  assert.equal(normalizeControllerSample(raw, p, 'other'), null);
  const normalized = normalizeControllerSample(raw, p, 'fixture');
  assert.equal(normalized.buttons[0], 1);
  assert.equal(normalized.axes[1], 1);
  assert.equal(
    validControllerProfile({ ...p, rawButtons: Array(16).fill(0) }),
    false
  );
});
