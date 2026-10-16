import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  assertDiscoveryArgs,
  collectE2eSources,
  e2eSelectionGaps,
  inspectE2eSource,
  selectedE2eFiles,
  workflowSelections
} from '../scripts/lib/e2e-selection.mjs';

const temporary = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-e2e-selection-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'og7-e2e-selection-')));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
};
const discovered = (root, specs, suites = []) => ({
  config: { rootDir: join(root, 'tests/playwright') },
  errors: [],
  suites: [{ file: 'entry.spec.ts', specs, suites }]
});
const spec = (file, expectedStatus = 'passed') => ({
  file,
  tests: [{ expectedStatus, annotations: [] }]
});

test('CI discovery follows actual commands and nested Yarn aliases without dropping filters', () => {
  assert.deepEqual(
    workflowSelections(
      [
        '      - run: yarn browsers',
        '        run: yarn exec playwright test --config "tests/ui.config.mjs" --project webkit',
        '        run: yarn test:e2e:acceptance'
      ].join('\n'),
      {
        browsers:
          'yarn child && playwright test --config=tests/public.config.mjs --grep "EN mobile"',
        child: 'playwright test --config tests/identity.config.mjs',
        'test:e2e:acceptance': 'node scripts/admin-acceptance.mjs'
      }
    ),
    [
      {
        config: 'tests/identity.config.mjs',
        args: ['--config', 'tests/identity.config.mjs']
      },
      {
        config: 'tests/public.config.mjs',
        args: ['--config=tests/public.config.mjs', '--grep', 'EN mobile']
      },
      {
        config: 'tests/ui.config.mjs',
        args: ['--config', 'tests/ui.config.mjs', '--project', 'webkit']
      },
      { config: 'playwright.config.ts', args: [] }
    ]
  );
  assert.throws(() => workflowSelections('run: yarn build'), /no E2E suites/);
  assert.throws(
    () => workflowSelections('run: playwright test --config'),
    /Missing E2E configuration/
  );
  assert.throws(
    () => workflowSelections('run: playwright test --config "$CONFIG"'),
    /static CLI arguments/
  );
});

test('each Yarn invocation retains forwarded filters, including nested aliases and differing invocations', () => {
  const scripts = {
    browsers: 'yarn nested',
    nested: 'playwright test --config tests/ui.config.mjs'
  };
  assert.deepEqual(
    workflowSelections(
      'run: yarn browsers --grep "EN mobile"\nrun: yarn browsers --grep nonexistent',
      scripts
    ),
    [
      {
        config: 'tests/ui.config.mjs',
        args: ['--config', 'tests/ui.config.mjs', '--grep', 'EN mobile']
      },
      {
        config: 'tests/ui.config.mjs',
        args: ['--config', 'tests/ui.config.mjs', '--grep', 'nonexistent']
      }
    ]
  );
  assert.deepEqual(
    workflowSelections('run: yarn browsers --project webkit', {
      browsers: 'yarn build && playwright test --config tests/ui.config.mjs'
    })[0].args,
    ['--config', 'tests/ui.config.mjs', '--project', 'webkit']
  );
  assert.throws(
    () =>
      workflowSelections('run: yarn browsers --grep nonexistent', {
        browsers: 'playwright test --config tests/ui.config.mjs\necho finished'
      }),
    /Multiline E2E Yarn scripts/
  );
});

test('sandbox verification discovery follows the dedicated runner contract without starting its stack', () => {
  const scripts = {
    'test:e2e:sandbox': 'node scripts/admin-sandbox.mjs --verify',
    'sandbox:admin': 'node scripts/admin-sandbox.mjs',
    nested: 'yarn test:e2e:sandbox'
  };
  const expected = [
    {
      config: 'tests/playwright-sandbox.config.mjs',
      args: ['--config', 'tests/playwright-sandbox.config.mjs', '--workers=1']
    }
  ];
  for (const command of [
    'yarn test:e2e:sandbox',
    'yarn nested',
    'yarn sandbox:admin --verify',
    'node scripts/admin-sandbox.mjs --verify'
  ])
    assert.deepEqual(workflowSelections('run: ' + command, scripts), expected);
  for (const command of [
    'yarn sandbox:admin',
    'yarn test:e2e:sandbox --grep changed',
    'node scripts/admin-sandbox.mjs --verify --config other.config.mjs',
    'node scripts/admin-sandbox.mjs --verify --verify'
  ])
    assert.throws(
      () => workflowSelections('run: ' + command, scripts),
      /exactly --verify/
    );
  assert.throws(
    () =>
      workflowSelections(
        [
          'jobs:',
          '  sandbox:',
          '    if: false',
          '    steps:',
          '      - run: yarn test:e2e:sandbox'
        ].join('\n'),
        scripts
      ),
    /Conditional E2E/
  );
});

const shardedWorkflow = (
  matrix = ['shard: [1, 2, 3]'],
  command = 'yarn acceptance --shard=${{ matrix.shard }}/3',
  run = [command]
) =>
  [
    'jobs:',
    '  docker:',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    ...matrix.map((line) => '        ' + line),
    '    steps:',
    '      - name: Acceptance',
    ...(run.length === 1
      ? ['        run: ' + run[0]]
      : ['        run: |', ...run.map((line) => '          ' + line)])
  ].join('\n');
const acceptanceScripts = { acceptance: 'node scripts/admin-acceptance.mjs' };

test('literal workflow shard matrices list every shard while preserving forwarded arguments', () => {
  for (const total of [3, 4]) {
    const values = Array.from({ length: total }, (_, index) => index + 1);
    assert.deepEqual(
      workflowSelections(
        shardedWorkflow(
          [`shard: [${values.join(', ')}]`],
          `yarn acceptance --shard=\${{ matrix.shard }}/${total}`
        ),
        acceptanceScripts
      ),
      values.map((value) => ({
        config: 'playwright.config.ts',
        args: [`--shard=${value}/${total}`]
      }))
    );
  }
  assert.deepEqual(
    workflowSelections(
      shardedWorkflow(['shard: [3, 1, 2]'], '', [
        'yarn build',
        'yarn nested --shard=${{ matrix.shard }}/3 --project chromium'
      ]),
      {
        nested: 'yarn browser',
        browser: 'playwright test --config tests/ui.config.mjs'
      }
    ).map(({ args }) => args),
    [3, 1, 2].map((value) => [
      '--config',
      'tests/ui.config.mjs',
      `--shard=${value}/3`,
      '--project',
      'chromium'
    ])
  );
});

test('matrix discovery uses only the enclosing job and refuses incomplete or dynamic shard matrices', () => {
  const invalidMatrices = [
    ['shard: [1, 2]'],
    ['shard: [1, 1, 3]'],
    ['shard: [0, 2, 3]'],
    ['shard: [1, 2, 4]'],
    ['shard: [1, 2, 3, 4]'],
    ['shard: [1, 2.5, 3]'],
    ['shard: [1, "2", 3]'],
    ['shard: [1, 2,]'],
    ['shard: ${{ fromJSON(inputs.shards) }}'],
    ['shard: [1, 2, 3]', 'include: [{ shard: 1 }]'],
    ['shard: [1, 2, 3]', 'exclude: [{ shard: 2 }]'],
    ['shard: [1, 2, 3]', 'project: [chromium, webkit]'],
    ['shard: [1, 2, 3]', 'shard: [1, 2, 3]']
  ];
  for (const matrix of invalidMatrices)
    assert.throws(
      () => workflowSelections(shardedWorkflow(matrix), acceptanceScripts),
      /shard matrix/
    );
  const otherJob = [
    '  unrelated:',
    '    strategy:',
    '      matrix:',
    '        shard: [1, 2, 3]',
    '    steps:',
    '      - run: yarn build'
  ].join('\n');
  assert.throws(
    () =>
      workflowSelections(
        shardedWorkflow(['shard: [1, 2]']) + '\n' + otherJob,
        acceptanceScripts
      ),
    /shard matrix/
  );
  for (const workflow of [
    'run: yarn acceptance --shard=${{ matrix.shard }}/3',
    shardedWorkflow().replace(
      'matrix:',
      'matrix: ${{ fromJSON(inputs.matrix) }}'
    ),
    shardedWorkflow().replace(
      'strategy:',
      'strategy: ${{ fromJSON(inputs.strategy) }}'
    )
  ])
    assert.throws(
      () => workflowSelections(workflow, acceptanceScripts),
      /shard matrix|enclosing workflow job/
    );
});

test('matrix expressions cannot become filters, arbitrary arguments or shell control flow', () => {
  for (const command of [
    'yarn acceptance --grep ${{ matrix.shard }}',
    'yarn acceptance --grep "${{ matrix.shard }}"',
    "yarn acceptance --grep '${{ matrix.shard }}'",
    'yarn acceptance --grep \\${{ matrix.shard }}',
    "yarn acceptance --grep 'x --shard=${{ matrix.shard }}/3 y'",
    'yarn acceptance --shard=${{ matrix.other }}/3',
    'yarn acceptance --shard=${{ matrix.shard + 1 }}/3',
    'yarn acceptance --shard=${{ matrix.shard }}/${{ matrix.total }}',
    'yarn acceptance --shard=${{ matrix.shard }}/3suffix',
    'yarn acceptance --shard=${{ matrix.shard }}/3 --shard=1/3',
    'yarn acceptance --shard=${{ matrix.shard }}/3 || true',
    'if false; then yarn acceptance --shard=${{ matrix.shard }}/3; fi'
  ])
    assert.throws(
      () =>
        workflowSelections(
          shardedWorkflow(undefined, command),
          acceptanceScripts
        ),
      /static CLI arguments|single matrix shard|shell control flow/
    );
  for (const placement of ['job', 'step']) {
    const workflow = shardedWorkflow().replace(
      placement === 'job' ? '    strategy:' : '        run:',
      placement === 'job'
        ? '    if: false\n    strategy:'
        : '        if: false\n        run:'
    );
    assert.throws(
      () => workflowSelections(workflow, acceptanceScripts),
      /Conditional E2E/
    );
  }
});

test('masked failures and shell conditionals never manufacture a successful selection', () => {
  const scripts = { browsers: 'playwright test --config tests/ui.config.mjs' };
  for (const command of [
    'yarn browsers || true',
    'false || yarn browsers',
    'if false; then yarn browsers; fi',
    'playwright test --config tests/ui.config.mjs || true'
  ])
    assert.throws(
      () => workflowSelections('run: ' + command, scripts),
      /shell control flow/
    );
  assert.deepEqual(
    workflowSelections('run: yarn browsers --grep "EN|FR"', scripts)[0].args,
    ['--config', 'tests/ui.config.mjs', '--grep', 'EN|FR']
  );
  assert.deepEqual(
    workflowSelections('run: yarn browsers --grep "\\d+"', scripts)[0].args,
    ['--config', 'tests/ui.config.mjs', '--grep', '\\d+']
  );
});

test('conditional E2E jobs and steps are rejected while unrelated always conditions remain valid', () => {
  const workflow = (condition, placement) =>
    [
      'jobs:',
      '  browser:',
      ...(placement === 'job' ? ['    if: ' + condition] : []),
      '    steps:',
      '      - name: E2E',
      '        run: playwright test --config tests/ui.config.mjs',
      ...(placement === 'step' ? ['        if: ' + condition] : []),
      '      - name: Preserve playwright test evidence',
      '        if: always()',
      '        run: echo evidence',
      '  final:',
      '    if: always()',
      '    steps:',
      '      - run: echo final'
    ].join('\n');
  for (const placement of ['job', 'step']) {
    for (const condition of [
      'false',
      '${{ false }}',
      "github.event_name == 'push'"
    ])
      assert.throws(
        () => workflowSelections(workflow(condition, placement)),
        /Conditional E2E/
      );
    assert.equal(workflowSelections(workflow('true', placement)).length, 1);
  }
});

test('literal run blocks retain complete commands and reject control flow or split arguments', () => {
  const workflow = (marker, body) =>
    'run: ' + marker + '\n' + body.map((line) => '  ' + line).join('\n');
  for (const body of [
    ['if false; then', '  playwright test --config tests/ui.config.mjs', 'fi'],
    ['if false; then', 'playwright test --config tests/ui.config.mjs', 'fi'],
    ['playwright test', '--config tests/ui.config.mjs', '--grep subset'],
    ['playwright test \\', '  --config tests/ui.config.mjs'],
    [
      'for item in one two; do',
      'playwright test --config tests/ui.config.mjs',
      'done'
    ]
  ])
    assert.throws(
      () => workflowSelections(workflow('|', body)),
      /Multiline E2E/
    );
  assert.throws(
    () =>
      workflowSelections(
        workflow('>', [
          'playwright test',
          '--config tests/ui.config.mjs',
          '--grep subset'
        ])
      ),
    /Folded E2E/
  );
  assert.throws(
    () =>
      workflowSelections(
        'run: playwright test\n  --config tests/ui.config.mjs\n  --grep subset'
      ),
    /Multiline E2E run scalars/
  );
  assert.deepEqual(
    workflowSelections(
      workflow('|', [
        'playwright test --config tests/first.config.mjs --grep subset',
        'playwright test --config tests/second.config.mjs --project webkit'
      ])
    ).map(({ args }) => args),
    [
      ['--config', 'tests/first.config.mjs', '--grep', 'subset'],
      ['--config', 'tests/second.config.mjs', '--project', 'webkit']
    ]
  );
  for (const earlyExit of [
    'exit 0',
    'exec true',
    'return 0',
    "trap 'exit 0' ERR"
  ]) {
    assert.throws(
      () =>
        workflowSelections(
          workflow('|', [
            earlyExit,
            'playwright test --config tests/ui.config.mjs'
          ])
        ),
      /Unsupported E2E preparation command/
    );
    assert.throws(
      () =>
        workflowSelections('run: yarn browsers', {
          browsers:
            earlyExit + ' && playwright test --config tests/ui.config.mjs'
        }),
      /Unsupported E2E preparation command/
    );
  }
});

test('terminators and interactive modes are rejected before the discovery CLI can execute', () => {
  for (const argument of [
    '--',
    '--ui',
    '--ui=true',
    '--ui-host',
    '--ui-host=127.0.0.1',
    '--ui-port',
    '--ui-port=4300',
    '--debug'
  ]) {
    assert.throws(
      () => assertDiscoveryArgs(['entry.spec.ts', argument]),
      /discovery forbids/
    );
    assert.throws(
      () =>
        workflowSelections('run: yarn browsers ' + argument, {
          browsers: 'playwright test --config tests/ui.config.mjs'
        }),
      /discovery forbids/
    );
  }
  assert.doesNotThrow(() =>
    assertDiscoveryArgs([
      '--config',
      'tests/ui.config.mjs',
      '--grep',
      'subset',
      '--project',
      'webkit'
    ])
  );
});

test('short configuration aliases cannot bypass the repository configuration path check', () => {
  for (const args of [
    ['-c', '../outside.config.mjs'],
    ['-c../outside.config.mjs'],
    ['-c=../outside.config.mjs']
  ]) {
    assert.throws(
      () => assertDiscoveryArgs(args),
      /short configuration aliases/
    );
    assert.throws(
      () => workflowSelections('run: playwright test ' + args.join(' ')),
      /short configuration aliases/
    );
  }
});

test('multiple configuration flags cannot select a different file from the one validated', () => {
  for (const args of [
    ['--config', 'tests/ui.config.mjs', '--config', '../outside.config.mjs'],
    ['--config=tests/ui.config.mjs', '--config=../outside.config.mjs'],
    ['--config', 'tests/ui.config.mjs', '--config=../outside.config.mjs']
  ]) {
    assert.throws(
      () => assertDiscoveryArgs(args),
      /single configuration option/
    );
    assert.throws(
      () => workflowSelections('run: playwright test ' + args.join(' ')),
      /single configuration option/
    );
  }
  assert.deepEqual(
    workflowSelections('run: playwright test --config=tests/ui.config.mjs')[0],
    {
      config: 'tests/ui.config.mjs',
      args: ['--config=tests/ui.config.mjs']
    }
  );
});

test('source inspection rejects aliases, bracket access and unfinished tests without matching comments or text', () => {
  const source = [
    "import { test as scenario } from '@playwright/test';",
    "import * as pw from '@playwright/test';",
    "// test.only('documentation example')",
    'const example = "test.fixme(\'example\')";',
    "scenario.describe.only('focused group', () => {});",
    "scenario['fixme'](true, 'unfinished');",
    "pw.test.fixme('namespace unfinished', () => {});"
  ].join('\n');
  assert.deepEqual(inspectE2eSource(source, 'fixture.spec.ts'), {
    declaresTests: true,
    unfinished: [
      'fixture.spec.ts:5: only test declaration',
      'fixture.spec.ts:6: fixme test declaration',
      'fixture.spec.ts:7: fixme test declaration'
    ]
  });
});

test('the source inventory includes registration modules and excludes UI helpers', (t) => {
  const root = temporary(t);
  mkdirSync(join(root, 'tests/playwright'), { recursive: true });
  for (const [name, source] of [
    ['entry.spec.ts', "test('entry', () => {});"],
    ['empty.spec.mjs', '// A missing declaration still needs coverage.'],
    [
      'registered.ui.ts',
      "export function register() { test('registered', () => {}); }"
    ],
    ['helper.ui.ts', 'export const fixture = () => ({ name: "Synthetic" });']
  ])
    writeFileSync(join(root, 'tests/playwright', name), source);
  assert.deepEqual(collectE2eSources(root), {
    files: [
      'tests/playwright/empty.spec.mjs',
      'tests/playwright/entry.spec.ts',
      'tests/playwright/registered.ui.ts'
    ],
    unfinished: []
  });
});

test('real report locations cover entry files and imported registries and expose orphan specs', (t) => {
  const root = temporary(t);
  const report = discovered(
    root,
    [],
    [
      {
        file: 'entry.spec.ts',
        specs: [spec('registered.ui.ts')]
      }
    ]
  );
  const selected = selectedE2eFiles(report, root);
  assert.equal(selected.active, 1);
  assert.deepEqual(
    e2eSelectionGaps(
      [
        'tests/playwright/entry.spec.ts',
        'tests/playwright/registered.ui.ts',
        'tests/playwright/orphan.spec.ts'
      ],
      selected.files
    ),
    ['tests/playwright/orphan.spec.ts']
  );
});

test('empty, skipped-only, malformed and unfinished discovery cannot report success', (t) => {
  const root = temporary(t);
  for (const report of [
    discovered(root, []),
    discovered(root, [spec('entry.spec.ts', 'skipped')]),
    discovered(root, [spec('entry.spec.ts', false)]),
    {
      ...discovered(root, [spec('entry.spec.ts')]),
      errors: [{ message: 'Synthetic failure' }]
    },
    discovered(root, [
      {
        ...spec('entry.spec.ts'),
        tests: [{ expectedStatus: 'skipped', annotations: [{ type: 'fixme' }] }]
      }
    ]),
    discovered(root, [spec('../../../outside.spec.ts')])
  ])
    assert.throws(() => selectedE2eFiles(report, root));
});
