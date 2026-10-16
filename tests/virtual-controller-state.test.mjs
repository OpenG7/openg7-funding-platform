import assert from 'node:assert/strict';
import test from 'node:test';

import { VirtualControllerState } from '../dist/apps/funding-web/src/app/features/funding/components/admin-controller/virtual-controller-state.js';
import {
  ControllerInput,
  defaultControllerProfile,
  normalizeControllerSample
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-pilotage/controller-input.js';

function device() {
  const source = new VirtualControllerState();
  const parser = new ControllerInput();
  const profile = defaultControllerProfile();
  let now = 0;
  return {
    source,
    parser,
    read: () =>
      parser.read(
        normalizeControllerSample(source.nextFrame(), profile, 'virtual'),
        (now += 17),
        profile
      )
  };
}

test('a brief first click receives an initial neutral sample and exactly one activation', () => {
  const { source, read } = device();
  source.enable(true);
  source.button(0, 1);
  source.releaseButton(0);
  assert.deepEqual(read(), []);
  assert.deepEqual(read(), ['primary']);
  assert.deepEqual(read(), []);
  assert.deepEqual(read(), []);
  assert.equal(source.snapshot().buttons[0], 0);
});

test('holding A through a parser reset cannot confirm a new dialog', () => {
  const { source, parser, read } = device();
  source.enable(true);
  read();
  source.button(0, 1);
  assert.deepEqual(read(), ['primary']);
  parser.reset();
  for (let i = 0; i < 20; i++) assert.deepEqual(read(), []);
  source.releaseButton(0);
  assert.deepEqual(read(), []);
  source.button(0, 1);
  assert.deepEqual(read(), ['primary']);
});

test('a held LT combines with LB without adding a direct primary action', () => {
  const { source, read } = device();
  source.enable(true);
  read();
  source.button(6, 1);
  assert.deepEqual(read(), []);
  source.button(4, 1);
  source.releaseButton(4);
  assert.deepEqual(read(), ['domainPrevious']);
  assert.deepEqual(read(), []);
  assert.equal(source.snapshot().buttons[6], 1);
  source.releaseAll();
  assert.deepEqual(read(), []);
  assert.deepEqual(read(), []);
  source.button(0, 1);
  assert.deepEqual(read(), ['primary']);
});

test('all 17 standard button indices are sampled, bounded and immutable', () => {
  const source = new VirtualControllerState();
  source.enable(true);
  source.nextFrame();
  for (let index = 0; index < 17; index++) source.button(index, 2);
  const snapshot = source.nextFrame();
  assert.deepEqual(snapshot.buttons, Array(17).fill(1));
  assert.equal(snapshot.mapping, 'standard');
  assert.throws(() => {
    snapshot.buttons[0] = 0;
  }, TypeError);
  source.button(-1, 1);
  source.button(17, 1);
  source.button(1, NaN);
  assert.equal(source.snapshot(), snapshot);
  source.releaseAll();
  assert.deepEqual(source.snapshot().buttons, Array(17).fill(0));
  assert.equal(snapshot.buttons[0], 1);
});

test('four axes retain brief mouse input for one frame, clamp and return to neutral', () => {
  const source = new VirtualControllerState();
  source.enable(true);
  source.nextFrame();
  [-2, 2, -0.75, 0.5].forEach((value, index) => {
    source.axis(index, value);
    source.releaseAxis(index);
  });
  assert.deepEqual(source.nextFrame().axes, [-1, 1, -0.75, 0.5]);
  assert.deepEqual(source.nextFrame().axes, [0, 0, 0, 0]);
  source.axis(0, NaN);
  source.axis(4, 1);
  assert.deepEqual(source.nextFrame().axes, [0, 0, 0, 0]);
});

test('RT, L3, R3 and Xbox are diagnostic inputs with no site command', () => {
  const { source, read } = device();
  source.enable(true);
  read();
  for (const index of [7, 10, 11, 16]) source.button(index, 1);
  assert.deepEqual(read(), []);
  assert.equal(source.snapshot().buttons[16], 1);
});

test('an interruption removes queued input before it can create an action', () => {
  const { source, read } = device();
  source.enable(true);
  source.button(0, 1);
  source.releaseAll();
  assert.deepEqual(read(), []);
  assert.deepEqual(read(), []);
  source.button(0, 1);
  assert.deepEqual(read(), ['primary']);
});

test('disable and reconnect clear the source and require a new neutral sample', () => {
  const { source, read } = device();
  source.enable(true);
  read();
  source.button(0, 1);
  assert.deepEqual(read(), ['primary']);
  source.enable(false);
  assert.equal(source.snapshot().connected, false);
  assert.deepEqual(source.snapshot().buttons, Array(17).fill(0));
  assert.deepEqual(read(), []);
  source.button(0, 1);
  assert.equal(source.snapshot().buttons[0], 0);
  source.enable(true);
  source.button(0, 1);
  source.releaseButton(0);
  assert.deepEqual(read(), []);
  assert.deepEqual(read(), ['primary']);
});
