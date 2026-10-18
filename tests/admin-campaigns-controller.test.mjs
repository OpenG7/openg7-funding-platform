import assert from 'node:assert/strict';
import test from 'node:test';

import { groupCampaignRows } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-campaigns-page/admin-campaigns-controller.js';

const row = (id) => ({ id, contributionId: 'synthetic-dossier' });

test('grouping retains server due-date order when dossiers are interleaved', () => {
  const rows = [
    row('first'),
    row('same-dossier-next'),
    { ...row('other-dossier'), contributionId: 'synthetic-other-dossier' },
    row('original-dossier-later')
  ];
  const groups = groupCampaignRows(rows, true);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((group) => group.id)).size, 3);
  assert.deepEqual(
    groups.flatMap((group) => group.rows),
    rows
  );
  assert.deepEqual(
    groups[0].rows.map((item) => item.id),
    ['first', 'same-dossier-next']
  );
  assert.deepEqual(groupCampaignRows(rows, false), [{ id: '', rows }]);
});
