import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markdownAnchors,
  markdownProse
} from '../scripts/lib/markdown-document.mjs';

test('documentation prose excludes fenced examples and preserves line positions', () => {
  const source = [
    'Before',
    '```markdown',
    '[Example](missing.md)',
    '# Example heading',
    '```',
    '[Real link](present.md)',
    '   ~~~html',
    '<a id="example-anchor"></a>',
    '   ~~~',
    'After'
  ];

  assert.equal(
    markdownProse(source.join('\r\n')),
    [
      'Before',
      '',
      '',
      '',
      '',
      '[Real link](present.md)',
      '',
      '',
      '',
      'After'
    ].join('\n')
  );
});

test('a fence closes only with its own marker and enough characters', () => {
  assert.equal(
    markdownProse(
      [
        'Before',
        '````markdown',
        '# Hidden',
        '```',
        '# Still hidden',
        '~~~~',
        '# Also hidden',
        '  `````',
        'After'
      ].join('\n')
    ),
    ['Before', '', '', '', '', '', '', '', 'After'].join('\n')
  );
});

test('an unclosed fence hides the rest of the document', () => {
  assert.equal(markdownProse('Before\n~~~\n# Hidden\nAfter'), 'Before\n\n\n');
});

test('four-space indentation is outside the existing fenced-code subset', () => {
  const source = 'Before\n    ```\nIndented example\n    ```\nAfter';
  assert.equal(markdownProse(source), source);
});

test('heading anchors preserve Unicode letters and combining marks', () => {
  assert.deepEqual(
    [...markdownAnchors('# État du projet\n## Cafe\u0301 et 日本語 — 2026')],
    ['état-du-projet', 'cafe\u0301-et-日本語--2026']
  );
});

test('heading labels and HTML markup do not alter duplicate-anchor numbering', () => {
  assert.deepEqual(
    [
      ...markdownAnchors(
        [
          '# [Readiness](status.md) <em>now</em>!',
          '## Readiness now',
          '###### Readiness now ###',
          '<a id="named-section"></a>',
          "<a name='legacy-section'></a>"
        ].join('\n')
      )
    ],
    [
      'named-section',
      'legacy-section',
      'readiness-now',
      'readiness-now-1',
      'readiness-now-2'
    ]
  );
});

test('fenced anchors and headings cannot satisfy a real documentation link', () => {
  assert.deepEqual(
    [
      ...markdownAnchors(
        [
          '# Same heading',
          '~~~markdown',
          '# Same heading',
          '<a id="example-only"></a>',
          '~~~',
          '## Same heading',
          '<a id="same-heading-1"></a>',
          '## Same heading'
        ].join('\n')
      )
    ],
    ['same-heading-1', 'same-heading', 'same-heading-2']
  );
});
