import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLICATION_MESSAGE_MAX_CODE_UNITS,
  composePublicationRecognition,
  isValidPublicationMessage,
  missingPublicationRecognitionSources,
  publicationRecognitionBlock
} from '../dist/packages/funding-core/src/index.js';
import {
  assertSponsorshipContent,
  composeSponsorshipContent
} from '../dist/apps/funding-api/src/publication-automation/content.js';

const contributionA = '00000000-0000-4000-8000-000000000001';
const contributionB = '00000000-0000-4000-8000-000000000002';
const sourceA = {
  id: 'draft-a',
  contributionId: contributionA,
  name: 'Atelier Boréal',
  title: 'Merci à Atelier Boréal',
  body: 'Un atelier soutient le projet. Une équipe prépare la suite.',
  disclosureText: 'Commandite rémunérée.'
};
const sourceB = {
  id: 'draft-b',
  contributionId: contributionB,
  name: 'Fabrique Rivage',
  title: 'Merci à Fabrique Rivage',
  body: 'La fabrique contribue au projet.',
  disclosureText: 'Commandite rémunérée.'
};
const blockA =
  'Merci à Atelier Boréal\n\nUn atelier soutient le projet. Une équipe prépare la suite.\n\nCommandite rémunérée.';
const blockB =
  'Merci à Fabrique Rivage\n\nLa fabrique contribue au projet.\n\nCommandite rémunérée.';
const contentMissing = { code: 'SOURCE_CONTENT_MISSING', status: 409 };

function snapshot(source) {
  return {
    id: source.id,
    contribution_id: source.contributionId,
    title: source.title,
    body: source.body,
    disclosure_text: source.disclosureText,
    feed_target: 'openg7',
    channel: 'facebook'
  };
}

function database(identities, preferences = [], profilesAvailable = true) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      let rows;
      if (sql.includes('FROM fund_contributions')) {
        const selected = identities.filter((identity) =>
          parameters[0].includes(identity.id)
        );
        rows = sql.startsWith('SELECT id,')
          ? selected
          : selected.map(({ sponsor_company_name }) => ({
              sponsor_company_name
            }));
      } else if (sql.includes('to_regclass')) {
        rows = [
          {
            table_name: profilesAvailable
              ? 'publication_editorial_profiles'
              : null
          }
        ];
      } else if (sql.includes('FROM publication_editorial_profiles')) {
        rows = [{ preferences }];
      } else {
        assert.fail(`Unexpected query: ${sql}`);
      }
      return { rows, rowCount: rows.length };
    }
  };
}

function sponsorDatabase(preferences = [], profilesAvailable = true) {
  return database(
    [
      { id: contributionA, sponsor_company_name: 'Atelier Boréal' },
      { id: contributionB, sponsor_company_name: 'Fabrique Rivage' }
    ],
    preferences,
    profilesAvailable
  );
}

function delivery(message, sources = [sourceA, sourceB]) {
  return {
    batch_id: 'batch-a',
    message,
    source_snapshot: sources.map(snapshot)
  };
}

test('publication budget accepts 2900 UTF-16 code units and refuses 2901', () => {
  assert.equal(PUBLICATION_MESSAGE_MAX_CODE_UNITS, 2900);
  assert.equal(isValidPublicationMessage('x'.repeat(2900)), true);
  assert.equal(isValidPublicationMessage('x'.repeat(2901)), false);
  assert.equal(isValidPublicationMessage(`x${' '.repeat(2900)}`), false);
  for (const invalid of ['', ' \r\n\t ', null, undefined, 2900, ['text']]) {
    assert.equal(isValidPublicationMessage(invalid), false);
  }
});

test('publication budget counts both UTF-16 code units of an emoji', () => {
  assert.equal(isValidPublicationMessage('😀'.repeat(1450)), true);
  assert.equal(isValidPublicationMessage(`${'😀'.repeat(1450)}x`), false);
  assert.equal(isValidPublicationMessage('😀'.repeat(1451)), false);
  assert.equal(isValidPublicationMessage(`${'😀'.repeat(1449)}ab`), true);
});

test('custom source titles receive a separate authoritative identity line', () => {
  for (const title of [
    'Notre soutien au quartier',
    'Atelier Boréal, partenaire du projet',
    'Merci à Atelier Boréal et à ses voisins'
  ]) {
    const source = { ...sourceA, title };
    const expected = `Partenaire : Atelier Boréal\n\n${title}\n\nUn atelier soutient le projet. Une équipe prépare la suite.\n\nCommandite rémunérée.`;
    assert.deepEqual(publicationRecognitionBlock(source), {
      sourceId: source.id,
      contributionId: contributionA,
      text: expected
    });
    assert.deepEqual(
      missingPublicationRecognitionSources(expected, [source]),
      []
    );
    assert.deepEqual(
      missingPublicationRecognitionSources(
        expected.replace('Partenaire : Atelier Boréal\n\n', ''),
        [source]
      ),
      ['draft-a']
    );
  }
});

test('complete recognized identity titles retain the existing source block', () => {
  for (const title of [
    'Atelier Boréal',
    'Merci à Atelier Boréal',
    'Un partenaire engagé : Atelier Boréal',
    'Commandite de visibilite - Atelier Boréal',
    'Partenaire : Atelier Boréal'
  ]) {
    assert.equal(
      publicationRecognitionBlock({ ...sourceA, title }).text,
      `${title}\n\nUn atelier soutient le projet. Une équipe prépare la suite.\n\nCommandite rémunérée.`
    );
  }
  assert.equal(
    composePublicationRecognition([sourceA, sourceB]),
    `${blockA}\n\n${blockB}`
  );
});

test('an incidental company name cannot recognize an omitted sponsor', () => {
  const incidental = {
    ...sourceB,
    body: 'La fabrique travaille près de l’Atelier Boréal.'
  };
  const message =
    'Merci à Fabrique Rivage\n\nLa fabrique travaille près de l’Atelier Boréal.\n\nCommandite rémunérée.';
  assert.deepEqual(
    missingPublicationRecognitionSources(message, [incidental, sourceA]),
    ['draft-a']
  );
});

test('a complete block quoted inside another source cannot recognize a second beneficiary', () => {
  const enclosing = {
    ...sourceB,
    body: `Une présentation du quartier.\n\n${blockA}\n\nUne autre activité suivra.`
  };
  const message = `Merci à Fabrique Rivage\n\nUne présentation du quartier.\n\n${blockA}\n\nUne autre activité suivra.\n\nCommandite rémunérée.`;
  assert.deepEqual(
    missingPublicationRecognitionSources(message, [sourceA, enclosing]),
    ['draft-a']
  );
});

test('truncated source text or missing disclosure leaves the source unrecognized', () => {
  for (const message of [
    'Merci à Atelier Boréal\n\nUn atelier soutient le projet.\n\nCommandite rémunérée.',
    'Merci à Atelier Boréal\n\nUn atelier soutient le projet. Une équipe prépare la suite.',
    blockA.slice(0, -1)
  ]) {
    assert.deepEqual(missingPublicationRecognitionSources(message, [sourceA]), [
      'draft-a'
    ]);
  }
});

test('recognition requires paragraph boundaries around the complete source block', () => {
  for (const message of [
    `Notre invitation : ${blockA}`,
    `${blockA} Découvrez le projet.`,
    `Une invitation.\n${blockA}\nLa suite arrive.`
  ]) {
    assert.deepEqual(missingPublicationRecognitionSources(message, [sourceA]), [
      'draft-a'
    ]);
  }
});

test('homonymous dossiers require two distinct occurrences of their complete blocks', () => {
  const homonym = {
    ...sourceA,
    id: 'draft-homonym',
    contributionId: contributionB
  };
  assert.deepEqual(
    missingPublicationRecognitionSources(blockA, [sourceA, homonym]),
    ['draft-homonym']
  );
  assert.deepEqual(
    missingPublicationRecognitionSources(`${blockA}\n\n${blockA}`, [
      sourceA,
      homonym
    ]),
    []
  );
});

test('NFC and CRLF normalization preserve recognition without changing the identity', () => {
  const decomposed = {
    ...sourceA,
    name: 'Atelier Bore\u0301al',
    title: 'Merci à Atelier Bore\u0301al',
    body: 'Une e\u0301quipe avance.\r\nUne seconde ligne.',
    disclosureText: 'Commandite re\u0301mune\u0301re\u0301e.'
  };
  const expected =
    'Merci à Atelier Boréal\n\nUne équipe avance.\nUne seconde ligne.\n\nCommandite rémunérée.';
  assert.equal(composePublicationRecognition([decomposed]), expected);
  assert.deepEqual(
    missingPublicationRecognitionSources(expected.replaceAll('\n', '\r\n'), [
      decomposed
    ]),
    []
  );
  assert.deepEqual(
    missingPublicationRecognitionSources(expected.normalize('NFD'), [
      decomposed
    ]),
    []
  );
  assert.deepEqual(
    missingPublicationRecognitionSources(expected.replace('Boréal', 'Boreal'), [
      decomposed
    ]),
    ['draft-a']
  );
});

test('complete source blocks may be reordered with additional surrounding copy', () => {
  const message = `Le projet prend forme.\n\n${blockB}\n\nUne rencontre vous attend.\n\n${blockA}\n\nDécouvrez le projet : https://example.test/projet.`;
  assert.deepEqual(
    missingPublicationRecognitionSources(message, [sourceA, sourceB]),
    []
  );
});

test('repeated source identifiers are refused even when both complete blocks are present', () => {
  const repeated = { ...sourceB, id: sourceA.id };
  const missing = missingPublicationRecognitionSources(
    `${blockA}\n\n${blockB}`,
    [sourceA, repeated]
  );
  assert.ok(missing.length > 0);
  assert.ok(missing.includes(sourceA.id));
});

test('missing or multiline authoritative identities and missing identifiers are refused', () => {
  for (const source of [
    { ...sourceA, name: '' },
    { ...sourceA, name: '   ' },
    { ...sourceA, name: 'Atelier\nBoréal' },
    { ...sourceA, contributionId: '' },
    { ...sourceA, id: '' }
  ]) {
    assert.ok(
      missingPublicationRecognitionSources(
        composePublicationRecognition([source]),
        [source]
      ).length > 0
    );
  }
});

test('sponsorship composition uses the dossier identity for a custom editable title', async () => {
  const source = { ...sourceA, title: 'Notre soutien au quartier' };
  const db = sponsorDatabase();
  assert.equal(
    await composeSponsorshipContent(db, 'openg7:facebook', [snapshot(source)]),
    'Partenaire : Atelier Boréal\n\nNotre soutien au quartier\n\nUn atelier soutient le projet. Une équipe prépare la suite.\n\nCommandite rémunérée.'
  );
  assert.deepEqual(db.calls[0].parameters, [[contributionA]]);
});

test('a concise editorial profile cannot remove part of a protected source block', async () => {
  const db = sponsorDatabase(['concise']);
  const message = await composeSponsorshipContent(db, 'openg7:facebook', [
    snapshot(sourceA)
  ]);
  assert.equal(message, blockA);
  assert.ok(
    db.calls.some(({ sql }) =>
      sql.includes('FROM publication_editorial_profiles')
    )
  );
});

test('an editorial change of the protected identity title falls back to the full source block', async () => {
  assert.equal(
    await composeSponsorshipContent(
      sponsorDatabase(['neutral']),
      'openg7:facebook',
      [snapshot(sourceA)]
    ),
    blockA
  );
});

test('a concise profile preserves a source call to action when its complete block survives', async () => {
  const source = {
    ...sourceA,
    body: 'Une contribution publique. Découvrez le projet : https://example.test/projet.'
  };
  assert.equal(
    await composeSponsorshipContent(
      sponsorDatabase(['concise']),
      'openg7:facebook',
      [snapshot(source)]
    ),
    'Merci à Atelier Boréal\n\nUne contribution publique. Découvrez le projet : https://example.test/projet.\n\nCommandite rémunérée.'
  );
});

test('composition without the editorial profile table retains the full recognized text', async () => {
  const db = sponsorDatabase([], false);
  assert.equal(
    await composeSponsorshipContent(db, 'openg7:facebook', [snapshot(sourceA)]),
    blockA
  );
  assert.ok(
    !db.calls.some(({ sql }) =>
      sql.includes('FROM publication_editorial_profiles')
    )
  );
});

test('composition and final-content validation refuse missing dossier names instead of trusting titles', async () => {
  for (const identities of [
    [],
    [{ id: contributionA, sponsor_company_name: '   ' }]
  ]) {
    await assert.rejects(
      composeSponsorshipContent(database(identities), 'openg7:facebook', [
        snapshot(sourceA)
      ]),
      contentMissing
    );
    await assert.rejects(
      assertSponsorshipContent(
        database(identities),
        delivery(blockA, [sourceA])
      ),
      contentMissing
    );
  }
  await assert.rejects(
    composeSponsorshipContent(sponsorDatabase(), 'openg7:facebook', []),
    contentMissing
  );
});

test('final-content validation accepts reordered complete blocks and an added call to action', async () => {
  const message = `${blockB}\n\n${blockA}\n\nDécouvrez le projet : https://example.test/projet.`;
  const row = delivery(message);
  const original = structuredClone(row);
  await assertSponsorshipContent(sponsorDatabase(), row);
  assert.deepEqual(row, original);
});

test('final-content validation blocks omitted or truncated beneficiaries and an empty snapshot', async () => {
  for (const row of [
    delivery(blockA),
    delivery(`${blockA}\n\nMerci à Fabrique Rivage\n\nCommandite rémunérée.`),
    delivery(`${blockA}\n\n${blockB}`, [])
  ]) {
    await assert.rejects(
      assertSponsorshipContent(sponsorDatabase(), row),
      contentMissing
    );
  }
});

test('final-content validation enforces the UTF-16 limit before reading dossier facts', async () => {
  for (const message of ['x'.repeat(2901), `${'😀'.repeat(1450)}x`, ' \n ']) {
    const db = sponsorDatabase();
    await assert.rejects(assertSponsorshipContent(db, delivery(message)), {
      code: 'INVALID_MESSAGE',
      status: 400
    });
    assert.equal(db.calls.length, 0);
  }
  const prefix = `${blockA}\n\n`;
  const remaining = 2900 - prefix.length;
  const message = `${prefix}${'😀'.repeat(Math.floor(remaining / 2))}${'x'.repeat(remaining % 2)}`;
  assert.equal(message.length, 2900);
  await assertSponsorshipContent(
    sponsorDatabase(),
    delivery(message, [sourceA])
  );
  const db = sponsorDatabase();
  await assert.rejects(
    assertSponsorshipContent(db, delivery(`${message}x`, [sourceA])),
    { code: 'INVALID_MESSAGE', status: 400 }
  );
  assert.equal(db.calls.length, 0);
});

test('editorial deliveries without a batch remain unchanged and do not read sponsorship facts', async () => {
  const db = {
    async query() {
      assert.fail('Editorial validation must not query sponsorship identities');
    }
  };
  for (const message of [
    '',
    'Un texte éditorial indépendant.',
    'x'.repeat(2901)
  ]) {
    const row = { batch_id: null, message, source_snapshot: [] };
    const original = structuredClone(row);
    await assertSponsorshipContent(db, row);
    assert.deepEqual(row, original);
  }
});
