import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicationJourneyObligation,
  publicationJourneyParams,
  publicationJourneySelection
} from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsorship-publication-navigation.js';

const id = (number) =>
  `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const target = (number, changes = {}) => ({
  key: id(number),
  channel: 'facebook',
  target: 'openg7',
  draftId: id(number),
  deliveryId: id(number + 10),
  obligationId: id(number + 20),
  ...changes
});

test('publication guideposts require a choice for multiple sources and can resolve a sole source', () => {
  for (const targets of [[], [target(1), target(2)]])
    assert.deepEqual(
      publicationJourneySelection(targets, new URLSearchParams()),
      {
        state: 'choose'
      }
    );
  const only = target(1);
  assert.deepEqual(publicationJourneySelection([only], new URLSearchParams()), {
    state: 'selected',
    target: only
  });
});

test('publication guideposts restore the exact source and jointly check all requested identifiers', () => {
  const targets = [target(1), target(2)];
  for (const name of ['draftId', 'deliveryId', 'obligationId']) {
    const params = new URLSearchParams({
      [name]: targets[1][name].toUpperCase()
    });
    assert.deepEqual(publicationJourneySelection(targets, params), {
      state: 'selected',
      target: targets[1]
    });
  }
  const params = new URLSearchParams(
    publicationJourneyParams(id(99), targets[1])
  );
  params.set('search', 'independent existing filter');
  assert.deepEqual(publicationJourneySelection(targets, params), {
    state: 'selected',
    target: targets[1]
  });
  params.set('draftId', targets[0].draftId);
  assert.deepEqual(publicationJourneySelection(targets, params), {
    state: 'unavailable'
  });
});

test('ambiguous shared deliveries and missing sources never select a different passage', () => {
  const targets = [target(1), target(2, { deliveryId: id(11) })];
  assert.deepEqual(
    publicationJourneySelection(
      targets,
      new URLSearchParams({ deliveryId: id(11) })
    ),
    {
      state: 'choose'
    }
  );
  assert.deepEqual(
    publicationJourneySelection(
      targets,
      new URLSearchParams({ deliveryId: id(11), draftId: id(2) })
    ),
    {
      state: 'selected',
      target: targets[1]
    }
  );
  assert.deepEqual(
    publicationJourneySelection(
      targets,
      new URLSearchParams({ draftId: id(404) })
    ),
    {
      state: 'unavailable'
    }
  );
});

test('malformed and repeated routing identifiers do not fall back to an available delivery', () => {
  for (const query of [
    'deliveryId=invalid',
    `draftId=${id(1)}&draftId=${id(1)}`,
    'obligationId='
  ])
    assert.deepEqual(
      publicationJourneySelection([target(1)], new URLSearchParams(query)),
      {
        state: 'unavailable'
      }
    );
});

test('evidence navigation uses an exact recorded obligation or unique workflow relationship', () => {
  const targets = [target(1), target(2)];
  const dossier = {
    commitment: {
      obligations: targets.map((row) => ({
        id: row.obligationId,
        channel: row.channel,
        target: row.target
      }))
    },
    publicationWorkflow: {
      obligations: targets.map((row) => ({
        obligationId: row.obligationId,
        deliveryId: row.deliveryId
      }))
    }
  };
  assert.equal(
    publicationJourneyObligation(dossier, targets[1], targets[1].obligationId),
    id(22)
  );
  assert.equal(publicationJourneyObligation(dossier, targets[1], null), id(22));
  assert.equal(
    publicationJourneyObligation(dossier, targets[1], id(404)),
    null
  );
  assert.equal(
    publicationJourneyObligation(
      dossier,
      { ...targets[1], channel: 'linkedin' },
      targets[1].obligationId
    ),
    null
  );
  assert.equal(
    publicationJourneyObligation(
      dossier,
      { ...targets[1], deliveryId: null },
      null
    ),
    null
  );
  dossier.publicationWorkflow.obligations[0].deliveryId = targets[1].deliveryId;
  assert.equal(publicationJourneyObligation(dossier, targets[1], null), null);
});

test('outbound navigation contains routing identifiers and no editorial or private context', () => {
  const source = {
    ...target(1),
    message: 'private text',
    contactEmail: 'private@example.invalid',
    version: 8
  };
  assert.deepEqual(publicationJourneyParams(id(99), source), {
    sponsorshipId: id(99),
    draftId: id(1),
    deliveryId: id(11),
    obligationId: id(21)
  });
  assert.deepEqual(
    publicationJourneyParams(
      id(99),
      target(1, { draftId: null, deliveryId: null, obligationId: null })
    ),
    {
      sponsorshipId: id(99)
    }
  );
});
