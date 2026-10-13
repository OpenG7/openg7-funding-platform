import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentFundingMonth,
  monthlyContributions,
  monthlyGoalProgress,
  parseContributionMinor
} from '../dist/apps/funding-web/src/app/features/funding/models/funding-home.utils.js';

test('Contribution input parses exact minor units without rewriting invalid amounts', () => {
  for (const [input, minor] of [
    ['25', 2500],
    ['25,50', 2550],
    ['0.01', 1],
    [' 50.20 ', 5020]
  ]) {
    assert.equal(parseContributionMinor(input), minor, input);
  }
  for (const input of [
    '',
    '-50',
    '+50',
    '1e3',
    '25.999',
    '1.2.3',
    '25.',
    '1 000',
    '0',
    'Infinity',
    '9007199254740992'
  ]) {
    assert.equal(parseContributionMinor(input), null, input);
  }
});

test('Monthly progress selects the UTC month and matching currency, including an empty new month', () => {
  const summary = [
    { month: '2026-09', currency: 'CAD', total_received: 135 },
    { month: '2026-08', currency: 'CAD', total_received: 900 },
    { month: '2026-10', currency: 'USD', total_received: 500 }
  ];
  assert.equal(
    currentFundingMonth(new Date('2026-09-30T19:59:59-04:00')),
    '2026-09'
  );
  assert.equal(
    currentFundingMonth(new Date('2026-09-30T20:00:00-04:00')),
    '2026-10'
  );
  assert.equal(monthlyContributions(summary, '2026-09', 'CAD'), 135);
  assert.equal(monthlyContributions(summary, '2026-10', 'CAD'), 0);
  assert.equal(monthlyContributions([], '2026-09', 'CAD'), 0);
});

test('Monthly target presentation rounds progress, caps completion and retains the outstanding amount', () => {
  for (const [received, goal, progress, remaining] of [
    [0, 270, 0, 270],
    [135, 270, 50, 135],
    [2, 3, 67, 1],
    [270, 270, 100, 0],
    [350, 270, 100, 0],
    [-10, 270, 0, 280],
    [10, 0, 0, 0],
    [10, -1, 0, 0]
  ])
    assert.deepEqual(monthlyGoalProgress(received, goal), {
      progress,
      remaining
    });
});
