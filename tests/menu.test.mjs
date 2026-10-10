import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import test from 'node:test';
import {
  createYarnInvocation,
  parseCommandArguments,
  parseMenuArgs,
  runMenu,
  runYarnCommand
} from '../scripts/lib/menu.mjs';
import {
  createCommandCatalog,
  MENU_CATEGORIES
} from '../scripts/lib/menu-catalog.mjs';

const packageScripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;

async function menuSession(scripts, answers, results = []) {
  const prompts = [];
  const output = [];
  const executions = [];
  const exitCode = await runMenu({
    catalog: createCommandCatalog(scripts),
    ask: async (prompt) => {
      prompts.push(prompt);
      return answers.length ? answers.shift() : null;
    },
    write: (message) => output.push(message),
    run: async (command, args) => {
      executions.push({ command, args });
      const result = results.length ? results.shift() : { code: 0 };
      if (result instanceof Error) throw result;
      return result;
    }
  });
  return { exitCode, prompts, output: output.join('\n'), executions };
}

test('menu CLI accepts listing and search while rejecting unsupported requests', () => {
  assert.deepEqual(parseMenuArgs([]), {
    help: false,
    list: false,
    search: ''
  });
  assert.deepEqual(parseMenuArgs(['--help']), {
    help: true,
    list: false,
    search: ''
  });
  assert.deepEqual(parseMenuArgs(['--list', '--search', 'docker']), {
    help: false,
    list: true,
    search: 'docker'
  });
  assert.deepEqual(parseMenuArgs(['--list', '--search', '']), {
    help: false,
    list: true,
    search: ''
  });
  for (const args of [
    ['--unknown'],
    ['--search', 'docker'],
    ['--search', ''],
    ['--list', '--search'],
    ['--list', '--search', '--help'],
    ['docker:up']
  ]) {
    assert.throws(() => parseMenuArgs(args), undefined, JSON.stringify(args));
  }
});

test('arguments preserve quoted values and shell syntax as literal child arguments', () => {
  assert.deepEqual(
    parseCommandArguments(
      "--label \"Bonjour monde\" --target 'site test' '' \"$HOME\" '$(whoami)' ';' '&'"
    ),
    [
      '--label',
      'Bonjour monde',
      '--target',
      'site test',
      '',
      '$HOME',
      '$(whoami)',
      ';',
      '&'
    ]
  );
  assert.deepEqual(
    parseCommandArguments(
      String.raw`--message "Il dit \"bonjour\"" --path C:\Temp\fixture.json escaped\ space`
    ),
    [
      '--message',
      'Il dit "bonjour"',
      '--path',
      String.raw`C:\Temp\fixture.json`,
      'escaped space'
    ]
  );
  assert.deepEqual(parseCommandArguments('   '), []);
  assert.deepEqual(parseCommandArguments(String.raw`--path "C:\Temp\\"`), [
    '--path',
    'C:\\Temp\\'
  ]);
  assert.deepEqual(
    parseCommandArguments(
      String.raw`--path \\server\share\fixture.json --path "C:\Temp\another fixture.json"`
    ),
    [
      '--path',
      String.raw`\\server\share\fixture.json`,
      '--path',
      String.raw`C:\Temp\another fixture.json`
    ]
  );
});

test('unfinished quotes and control characters cannot reach the command runner', () => {
  for (const input of [
    '"unfinished',
    "'unfinished",
    'one\ntwo',
    'one\rtwo',
    'one\u0000two',
    'one\u001btwo',
    'one\u007ftwo'
  ]) {
    assert.throws(() => parseCommandArguments(input));
  }
});

test('Yarn invocation uses its JavaScript launcher and forwards each argument separately', () => {
  for (const yarnPath of [
    '/tools/yarn.js',
    '/tools/yarn.cjs',
    '/tools/yarn.mjs'
  ]) {
    assert.deepEqual(
      createYarnInvocation('dev:api', ['--port', '3001', 'a b'], {
        env: { npm_execpath: yarnPath },
        execPath: '/tools/node',
        platform: 'linux'
      }),
      {
        command: '/tools/node',
        args: [yarnPath, 'run', 'dev:api', '--port', '3001', 'a b']
      }
    );
  }
  assert.deepEqual(
    createYarnInvocation('lint', [], {
      env: { npm_execpath: '/tools/npm-cli.js' },
      execPath: '/tools/node',
      platform: 'linux'
    }),
    { command: 'yarn', args: ['run', 'lint'] }
  );
});

test('Corepack resolves Yarn without a shell and direct Windows fallback gives a useful error', () => {
  assert.deepEqual(
    createYarnInvocation('lint', [], {
      env: { COREPACK_ROOT: '/tools/corepack' },
      execPath: '/tools/node',
      platform: 'linux'
    }),
    {
      command: '/tools/node',
      args: [posix.join('/tools/corepack', 'dist', 'yarn.js'), 'run', 'lint']
    }
  );
  assert.deepEqual(
    createYarnInvocation('lint', [], {
      env: {},
      execPath: '/tools/node',
      platform: 'darwin'
    }),
    { command: 'yarn', args: ['run', 'lint'] }
  );
  assert.throws(
    () =>
      createYarnInvocation('lint', [], {
        env: {},
        execPath: 'C:\\tools\\node.exe',
        platform: 'win32'
      }),
    /yarn menu/
  );
  assert.deepEqual(
    createYarnInvocation('lint', [], {
      env: {
        npm_execpath: String.raw`C:\tools\yarn`,
        COREPACK_ROOT: String.raw`C:\tools\corepack`
      },
      execPath: String.raw`C:\tools\node.exe`,
      platform: 'win32'
    }),
    {
      command: String.raw`C:\tools\node.exe`,
      args: [String.raw`C:\tools\corepack\dist\yarn.js`, 'run', 'lint']
    }
  );
});

test('command runner inherits the terminal and starts Yarn without shell interpretation', async () => {
  const child = new EventEmitter();
  const signals = new EventEmitter();
  const env = { npm_execpath: '/tools/yarn.js' };
  const launches = [];
  const pending = runYarnCommand('dev:api', ['a b', '$HOME', ';'], {
    root: '/synthetic/project',
    env,
    execPath: '/tools/node',
    platform: 'linux',
    signalSource: signals,
    spawnProcess: (command, args, options) => {
      launches.push({ command, args, options });
      return child;
    }
  });
  child.emit('close', 7, null);
  const result = await pending;
  assert.equal(result.code, 7);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].command, '/tools/node');
  assert.deepEqual(launches[0].args, [
    '/tools/yarn.js',
    'run',
    'dev:api',
    'a b',
    '$HOME',
    ';'
  ]);
  assert.equal(launches[0].options.cwd, '/synthetic/project');
  assert.equal(launches[0].options.env, env);
  assert.equal(launches[0].options.shell, false);
  assert.equal(launches[0].options.windowsHide, true);
  assert.ok(
    launches[0].options.stdio === 'inherit' ||
      JSON.stringify(launches[0].options.stdio) ===
        JSON.stringify(['inherit', 'inherit', 'inherit'])
  );
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('runner reports interruptions even when the child exits cleanly and removes signal listeners', async () => {
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143]
  ]) {
    const child = new EventEmitter();
    const signals = new EventEmitter();
    const forwarded = [];
    child.kill = (value) => forwarded.push(value);
    const pending = runYarnCommand('dev:api', [], {
      root: '/synthetic/project',
      env: {},
      platform: 'linux',
      signalSource: signals,
      spawnProcess: () => child
    });
    signals.emit(signal);
    child.emit('close', 0, null);
    const result = await pending;
    assert.equal(result.code, code);
    assert.equal(result.signal, signal);
    assert.deepEqual(forwarded, signal === 'SIGTERM' ? ['SIGTERM'] : []);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  }
});

test('launch errors clear signal listeners and suppress arbitrary child diagnostics', async () => {
  const child = new EventEmitter();
  const signals = new EventEmitter();
  const pending = runYarnCommand('dev:api', [], {
    root: '/synthetic/project',
    env: {},
    platform: 'linux',
    signalSource: signals,
    spawnProcess: () => child
  });
  child.emit('error', new Error('synthetic-private-diagnostic'));
  await assert.rejects(pending, (error) => {
    assert.doesNotMatch(error.message, /synthetic-private-diagnostic/);
    return true;
  });
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('synchronous launch exceptions suppress diagnostics without installing signal listeners', async () => {
  const signals = new EventEmitter();
  const pending = runYarnCommand('dev:api', [], {
    root: '/synthetic/project',
    env: {},
    platform: 'linux',
    signalSource: signals,
    spawnProcess: () => {
      throw new Error('synthetic-private-diagnostic');
    }
  });
  await assert.rejects(pending, (error) => {
    assert.doesNotMatch(error.message, /synthetic-private-diagnostic/);
    return true;
  });
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('catalog exposes every package script once except the menu itself', () => {
  const catalog = createCommandCatalog(packageScripts);
  assert.deepEqual(
    catalog.map(({ name }) => name).sort(),
    Object.keys(packageScripts)
      .filter((name) => name !== 'menu')
      .sort()
  );
  const categories = new Set(MENU_CATEGORIES.map(({ id }) => id));
  for (const command of catalog) {
    assert.ok(categories.has(command.category), command.name);
    assert.ok(command.label, command.name);
  }
  const custom = createCommandCatalog({
    menu: 'node scripts/menu.mjs',
    'custom:refresh': 'node scripts/custom-refresh.mjs'
  });
  assert.equal(custom.length, 1);
  assert.equal(custom[0].name, 'custom:refresh');
  assert.equal(custom[0].confirmation, true);
});

test('live, production, remote and state-changing commands require confirmation', () => {
  const names = [
    'docker:up:prod',
    'stripe:events:resend:live',
    'stripe:backfill:live',
    'prod:deploy',
    'prod:rollback',
    'vps:db:update',
    'db:restore',
    'db:migrate',
    'storage:publish',
    'email:test'
  ];
  const catalog = createCommandCatalog(
    Object.fromEntries(names.map((name) => [name, 'node synthetic.mjs']))
  );
  for (const name of names) {
    assert.equal(
      catalog.find((command) => command.name === name)?.confirmation,
      true,
      name
    );
  }
});

test('quitting and end of input perform no operation', async () => {
  for (const answers of [['0'], [null], ['1', null], ['1', '1', null]]) {
    const session = await menuSession({ 'dev:api': 'node api.mjs' }, answers);
    assert.equal(session.exitCode, 0);
    assert.deepEqual(session.executions, []);
  }
});

test('development commands return to their category after completing', async () => {
  const session = await menuSession({ 'dev:api': 'node api.mjs' }, [
    '1',
    '1',
    '',
    '0',
    '0'
  ]);
  assert.equal(session.exitCode, 0);
  assert.deepEqual(session.executions, [{ command: 'dev:api', args: [] }]);
  assert.match(session.output, /yarn dev:api/);
});

test('all commands can be searched and an unknown script requires exact authorization', async () => {
  const scripts = { 'custom:refresh': 'node custom.mjs' };
  const cancelled = await menuSession(scripts, [
    '6',
    'custom:refresh',
    '1',
    '',
    'oui',
    '0',
    '0'
  ]);
  assert.deepEqual(cancelled.executions, []);
  const accepted = await menuSession(scripts, [
    '6',
    'custom:refresh',
    '1',
    '',
    'executer custom:refresh',
    '0',
    '0'
  ]);
  assert.deepEqual(accepted.executions, [
    { command: 'custom:refresh', args: [] }
  ]);
});

test('additional arguments require authorization and reach the runner without shell expansion', async () => {
  const session = await menuSession({ 'dev:api': 'node api.mjs' }, [
    '1',
    '1',
    '--label "A B" "$HOME" \'$(whoami)\' \';\'',
    'executer dev:api',
    '0',
    '0'
  ]);
  assert.deepEqual(session.executions, [
    { command: 'dev:api', args: ['--label', 'A B', '$HOME', '$(whoami)', ';'] }
  ]);
  const cancelled = await menuSession({ 'dev:api': 'node api.mjs' }, [
    '1',
    '1',
    '--environment prod',
    '',
    '0',
    '0'
  ]);
  assert.deepEqual(cancelled.executions, []);
});

test('obvious secrets are refused before display or command execution', async () => {
  for (const [args, secret] of [
    ['--token=synthetic-private-value', 'synthetic-private-value'],
    ['--admin-token synthetic-private-value', 'synthetic-private-value'],
    ['--key sk_test_synthetic_private', 'sk_test_synthetic_private'],
    [
      '--url https://synthetic-user:synthetic-private@example.test',
      'synthetic-private'
    ]
  ]) {
    const session = await menuSession({ 'dev:api': 'node api.mjs' }, [
      '1',
      '1',
      args,
      '0',
      '0'
    ]);
    assert.deepEqual(session.executions, []);
    assert.ok(!session.output.includes(secret), args);
  }
});

test('Docker shutdown retains the ordinary confirmation when its volumes are preserved', async () => {
  for (const [rawArgs, args] of [
    ['', []],
    ['--volumes=false', ['--volumes=false']],
    ['--volumes --volumes=false', ['--volumes', '--volumes=false']],
    ['-f v=false.yml', ['-f', 'v=false.yml']],
    ['--env-file --volumes=false', ['--env-file', '--volumes=false']],
    ['-v=false', ['-v=false']],
    ['--volume=false', ['--volume=false']],
    ['-- --volumes', ['--', '--volumes']]
  ]) {
    const session = await menuSession(
      { 'docker:down': 'docker compose down' },
      ['2', '1', rawArgs, 'executer docker:down', '0', '0']
    );
    assert.deepEqual(session.executions, [{ command: 'docker:down', args }]);
    assert.match(session.output, /volumes sont conserv[ée]s/iu);
    assert.doesNotMatch(session.output, /donn[ée]es PostgreSQL/iu);
    assert.ok(
      session.prompts.some((prompt) => prompt.includes('executer docker:down'))
    );
    assert.ok(
      session.prompts.every(
        (prompt) => !prompt.includes('supprimer volumes docker:down')
      )
    );
  }
});

test('Docker volume removal requires its specific confirmation and forwards the chosen option', async () => {
  for (const [rawArgs, args] of [
    ['-v', ['-v']],
    ['--volumes', ['--volumes']],
    ['--volumes=true', ['--volumes=true']],
    ['-vt10', ['-vt10']],
    ['-vt=0', ['-vt=0']],
    ['--volume', ['--volume']],
    ['--volume=true', ['--volume=true']],
    ['-vv=1', ['-vv=1']],
    ['-v -f v=false.yml', ['-v', '-f', 'v=false.yml']],
    ['-v --env-file --volumes=false', ['-v', '--env-file', '--volumes=false']],
    [
      '--volumes --workdir --volumes=false',
      ['--volumes', '--workdir', '--volumes=false']
    ]
  ]) {
    const session = await menuSession(
      { 'docker:down': 'docker compose down' },
      ['2', '1', rawArgs, 'supprimer volumes docker:down', '0', '0']
    );
    assert.deepEqual(session.executions, [{ command: 'docker:down', args }]);
    assert.match(session.output, /PostgreSQL/u);
    assert.match(session.output, /m[ée]dias/iu);
    assert.match(session.output, /donn[ée]es/iu);
    assert.doesNotMatch(session.output, /volumes sont conserv[ée]s/iu);
    assert.ok(
      session.prompts.some((prompt) =>
        prompt.includes('supprimer volumes docker:down')
      )
    );
  }
});

test('ordinary authorization, empty confirmation and EOF cannot approve Docker volume removal', async () => {
  for (const confirmation of ['executer docker:down', '', null]) {
    const session = await menuSession(
      { 'docker:down': 'docker compose down' },
      ['2', '1', '--volumes', confirmation, '0', '0']
    );
    assert.deepEqual(session.executions, []);
    assert.doesNotMatch(session.output, /volumes sont conserv[ée]s/iu);
  }
});

test('storage publication accepts its required object keys and retains confirmation', async () => {
  const args = [
    '--source-key',
    'uploads/sponsors/synthetic/original.webp',
    '--target-key',
    'public/sponsors/synthetic/profile-synthetic.webp',
    '--content-type',
    'image/webp'
  ];
  const session = await menuSession(
    { 'storage:publish': 'bash publish-sponsor-media.sh' },
    ['5', '1', args.join(' '), 'executer storage:publish', '0', '0']
  );
  assert.deepEqual(session.executions, [{ command: 'storage:publish', args }]);
  assert.ok(
    session.prompts.some((prompt) =>
      prompt.includes('executer storage:publish')
    )
  );
});

test('storage unpublication accepts its object-key aliases and dry-run option', async () => {
  for (const flag of ['--key', '--target-key']) {
    const args = [flag, 'public/sponsors/synthetic/profile.webp', '--dry-run'];
    const session = await menuSession(
      { 'storage:unpublish': 'bash unpublish-sponsor-media.sh' },
      ['5', '1', args.join(' '), 'executer storage:unpublish', '0', '0']
    );
    assert.deepEqual(session.executions, [
      { command: 'storage:unpublish', args }
    ]);
  }
});

test('storage object-key exceptions cannot bypass secret detection or authorize other commands', async () => {
  for (const [name, args, secret] of [
    [
      'storage:publish',
      '--source-key sk_test_synthetic_private',
      'sk_test_synthetic_private'
    ],
    [
      'storage:publish',
      '--api-key synthetic-private-value',
      'synthetic-private-value'
    ],
    [
      'storage:publish',
      '--source-key https://user:synthetic-private@example.test/media.webp',
      'synthetic-private'
    ],
    [
      'custom:refresh',
      '--key public/sponsors/synthetic/profile.webp',
      'public/sponsors/synthetic/profile.webp'
    ],
    [
      'custom:refresh',
      '--source-key uploads/sponsors/synthetic/original.webp',
      'uploads/sponsors/synthetic/original.webp'
    ]
  ]) {
    const session = await menuSession({ [name]: 'node synthetic.mjs' }, [
      '6',
      '',
      '1',
      args,
      `executer ${name}`,
      '0',
      '0'
    ]);
    assert.deepEqual(session.executions, [], name);
    assert.ok(!session.output.includes(secret), args);
  }
});

test('permitted storage object-key arguments still allow cancellation and EOF', async () => {
  for (const [name, args] of [
    [
      'storage:publish',
      '--source-key uploads/sponsors/synthetic/original.webp --target-key public/sponsors/synthetic/profile.webp --content-type image/webp'
    ],
    [
      'storage:unpublish',
      '--key public/sponsors/synthetic/profile.webp --dry-run'
    ]
  ]) {
    for (const confirmation of ['', null]) {
      const session = await menuSession({ [name]: 'bash synthetic.sh' }, [
        '5',
        '1',
        args,
        confirmation,
        '0',
        '0'
      ]);
      assert.deepEqual(session.executions, [], name);
    }
  }
});

test('help arguments avoid only the additional-arguments confirmation', async () => {
  const development = await menuSession({ 'dev:api': 'node api.mjs' }, [
    '1',
    '1',
    '--help',
    '0',
    '0'
  ]);
  assert.deepEqual(development.executions, [
    { command: 'dev:api', args: ['--help'] }
  ]);
  const sensitive = await menuSession({ 'custom:refresh': 'node custom.mjs' }, [
    '6',
    '',
    '1',
    '--help',
    null
  ]);
  assert.deepEqual(sensitive.executions, []);
});

test('EOF during arguments or confirmation exits without starting the selected command', async () => {
  for (const [scripts, answers] of [
    [{ 'custom:refresh': 'node custom.mjs' }, ['6', '', '1', null]],
    [{ 'custom:refresh': 'node custom.mjs' }, ['6', '', '1', '', null]],
    [{ 'dev:api': 'node api.mjs' }, ['1', '1', '--environment prod', null]]
  ]) {
    const session = await menuSession(scripts, answers);
    assert.deepEqual(session.executions, []);
  }
});

test('invalid menu choices, empty search results and malformed arguments never execute a command', async () => {
  const session = await menuSession({ 'dev:api': 'node api.mjs' }, [
    '999',
    '1',
    '999',
    '1',
    '"unfinished',
    null
  ]);
  assert.deepEqual(session.executions, []);
  const search = await menuSession({ 'dev:api': 'node api.mjs' }, [
    '6',
    'nothing-matches',
    null
  ]);
  assert.deepEqual(search.executions, []);
});

test('command failures are visible and do not prevent retry or hide behind a later success', async () => {
  const session = await menuSession(
    { 'dev:api': 'node api.mjs' },
    ['1', '1', '', '1', '', '0', '0'],
    [{ code: 7 }, { code: 0 }]
  );
  assert.equal(session.exitCode, 7);
  assert.equal(session.executions.length, 2);
  assert.match(session.output, /7/);
});

test('launch rejection permits retry and does not disclose arbitrary diagnostics', async () => {
  const session = await menuSession(
    { 'dev:api': 'node api.mjs' },
    ['1', '1', '', '1', '', '0', '0'],
    [new Error('synthetic-private-diagnostic'), { code: 0 }]
  );
  assert.equal(session.exitCode, 1);
  assert.equal(session.executions.length, 2);
  assert.doesNotMatch(session.output, /synthetic-private-diagnostic/);
});

test('termination stops the menu without asking for another operation', async () => {
  const session = await menuSession(
    { 'dev:api': 'node api.mjs' },
    ['1', '1', '', '1', ''],
    [{ code: 143, signal: 'SIGTERM' }]
  );
  assert.equal(session.exitCode, 143);
  assert.equal(session.executions.length, 1);
  assert.equal(session.prompts.length, 3);
  assert.match(session.output, /SIGTERM/);
});

test('CLI help and listing work without a terminal, while interactive mode explains its requirement', () => {
  const cli = (args) =>
    spawnSync(process.execPath, ['scripts/menu.mjs', ...args], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, FORCE_COLOR: '0' }
    });
  const help = cli(['--help']);
  assert.equal(help.status, 0, help.stdout + help.stderr);
  assert.match(help.stdout, /--list/);
  const list = cli(['--list']);
  assert.equal(list.status, 0, list.stdout + list.stderr);
  for (const name of Object.keys(packageScripts).filter(
    (name) => name !== 'menu'
  )) {
    assert.ok(list.stdout.includes(name), name);
  }
  const search = cli(['--list', '--search', 'dev:api']);
  assert.equal(search.status, 0, search.stdout + search.stderr);
  assert.match(search.stdout, /dev:api/);
  assert.doesNotMatch(search.stdout, /prod:deploy/);
  const interactive = cli([]);
  assert.notEqual(interactive.status, 0);
  assert.match(interactive.stdout + interactive.stderr, /--list|--help/);
});
