import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// UTF-8 byte budgets, not token estimates. No dependencies, network or mutations.
const budgets = {
  'AGENTS.md': 8192,
  'apps/funding-web/AGENTS.md': 6144,
  'apps/funding-api/AGENTS.md': 6144,
  'packages/AGENTS.md': 3072,
  'scripts/AGENTS.md': 5120,
  'docs/ARCHITECTURE.md': 14336,
  'docs/ARCHITECTURE.en.md': 14336,
  'docs/development/financial-rules.md': 10240,
  'docs/development/sponsorship-rules.md': 6144,
  'docs/development/validation.md': 8192,
  'docs/development/documentation.md': 8192,
  'README.md': 7168,
  'CONTRIBUTING.md': 2048,
  'docs/README.md': 14336,
  'docs/command-cheatsheet.md': 14336,
  'docs/technical/configuration.md': 12288,
  'docs/technical/admin-api.md': 15360,
  'docs/technical/public-api.md': 7168,
  'docs/technical/stripe.md': 8192
};

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = path.resolve(
  rootIndex < 0
    ? fileURLToPath(new URL('../', import.meta.url))
    : (args[rootIndex + 1] ?? '')
);
const allowedArgs = rootIndex < 0 ? [] : ['--root', args[rootIndex + 1]];
if (
  (rootIndex >= 0 && !args[rootIndex + 1]) ||
  args.some((arg) => arg !== '--json' && !allowedArgs.includes(arg))
) {
  throw new Error(
    'Usage: node scripts/check-agent-docs.mjs [--json] [--root directory]'
  );
}

const errors = [];
const documents = new Map();
const workspaceManifests = new Map();
for (const parent of ['apps', 'packages']) {
  for (const entry of fs.readdirSync(path.join(root, parent), {
    withFileTypes: true
  })) {
    if (!entry.isDirectory()) continue;
    const manifest = `${parent}/${entry.name}/package.json`;
    if (fs.existsSync(path.join(root, manifest))) {
      const { name } = JSON.parse(
        fs.readFileSync(path.join(root, manifest), 'utf8')
      );
      workspaceManifests.set(name, manifest);
    }
  }
}
function read(relative) {
  if (!documents.has(relative)) {
    documents.set(relative, fs.readFileSync(path.join(root, relative), 'utf8'));
  }
  return documents.get(relative);
}

function withoutCode(text) {
  let fence = null;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length
        ) {
          fence = null;
        }
        return '';
      }
      return fence ? '' : line;
    })
    .join('\n');
}

function anchors(text) {
  const result = new Set();
  const counts = new Map();
  for (const match of withoutCode(text).matchAll(
    /<a\s+(?:id|name)=["']([^"']+)["']/g
  )) {
    result.add(match[1]);
  }
  for (const match of withoutCode(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(base) ?? 0;
    result.add(count ? `${base}-${count}` : base);
    counts.set(base, count + 1);
  }
  return result;
}

let checkedLinks = 0;
const sizes = {};
const manifests = new Map();
for (const [file, maxBytes] of Object.entries(budgets)) {
  try {
    const text = read(file);
    const bytes = Buffer.byteLength(text);
    sizes[file] = { bytes, maxBytes };
    if (bytes > maxBytes)
      errors.push(`${file}: ${bytes} bytes exceeds ${maxBytes}`);
    const prose = withoutCode(text);
    for (const match of prose.matchAll(
      /!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g
    )) {
      const href = match[1];
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) continue;
      const [rawTarget, rawAnchor] = href.split('#');
      const target = rawTarget
        ? path.resolve(root, path.dirname(file), decodeURIComponent(rawTarget))
        : path.resolve(root, file);
      const relative = path.relative(root, target);
      if (
        relative.startsWith(`..${path.sep}`) ||
        relative === '..' ||
        path.isAbsolute(relative)
      ) {
        errors.push(`${file}: link outside repository: ${href}`);
        continue;
      }
      checkedLinks++;
      if (!fs.existsSync(target))
        errors.push(`${file}: missing target ${href}`);
      else if (rawAnchor && target.endsWith('.md')) {
        if (!anchors(read(relative)).has(decodeURIComponent(rawAnchor))) {
          errors.push(`${file}: missing anchor ${href}`);
        }
      }
    }
    // Validate declared Yarn commands without executing any of them.
    for (const match of text.matchAll(
      /\byarn\s+(?:workspace\s+(@[\w/-]+)\s+)?([\w][\w:-]*)/g
    )) {
      const [, workspace, command] = match;
      if (
        [
          'install',
          'exec',
          'workspace',
          'workspaces',
          'dlx',
          'set',
          'config'
        ].includes(command)
      )
        continue;
      const manifest = workspace
        ? workspaceManifests.get(workspace)
        : 'package.json';
      if (!manifest) {
        errors.push(`${file}: unknown Yarn workspace ${workspace}`);
        continue;
      }
      if (!manifests.has(manifest))
        manifests.set(manifest, JSON.parse(read(manifest)));
      if (!manifests.get(manifest).scripts?.[command]) {
        errors.push(
          `${file}: unknown Yarn script ${workspace ?? '(root)'} ${command}`
        );
      }
    }
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
  }
}

const ignored = new Set([
  '.git',
  '.yarn',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'backups',
  '.angular'
]);
function inspectInstructions(directory = '') {
  for (const entry of fs.readdirSync(path.join(root, directory), {
    withFileTypes: true
  })) {
    if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) inspectInstructions(relative);
    else if (/^AGENTS(?:\.override)?\.md$/.test(entry.name)) {
      if (!(relative in budgets))
        errors.push(`${relative}: add an explicit instruction budget`);
      const parents = relative.split('/').slice(0, -1);
      let chainBytes = fs.statSync(path.join(root, relative)).size;
      for (let i = 0; i < parents.length; i++) {
        const parent = path.join(root, ...parents.slice(0, i));
        const candidate = ['AGENTS.override.md', 'AGENTS.md'].find((name) =>
          fs.existsSync(path.join(parent, name))
        );
        if (candidate)
          chainBytes += fs.statSync(path.join(parent, candidate)).size;
      }
      if (chainBytes > 16384)
        errors.push(
          `${relative}: instruction chain ${chainBytes} exceeds 16384 bytes`
        );
    }
  }
}
inspectInstructions();

const scenarios = {
  documentation: ['AGENTS.md', 'docs/development/validation.md'],
  web: [
    'AGENTS.md',
    'apps/funding-web/AGENTS.md',
    'docs/development/validation.md'
  ],
  payment: [
    'AGENTS.md',
    'apps/funding-api/AGENTS.md',
    'docs/development/financial-rules.md',
    'docs/development/validation.md'
  ],
  architecture: [
    'AGENTS.md',
    'docs/ARCHITECTURE.md',
    'docs/development/validation.md'
  ]
};
const report = {
  unit: 'UTF-8 bytes, not tokens; excludes code and additional task-specific reads',
  files: sizes,
  checkedLinks,
  scenarios: Object.fromEntries(
    Object.entries(scenarios).map(([name, files]) => [
      name,
      files.reduce((n, file) => n + (sizes[file]?.bytes ?? 0), 0)
    ])
  ),
  errors
};
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `Checked ${Object.keys(sizes).length} documentation budgets and ${checkedLinks} local links/anchors.`
  );
  for (const [name, bytes] of Object.entries(report.scenarios))
    console.log(`${name}: ${bytes} UTF-8 bytes`);
  for (const error of errors) console.error(error);
}
process.exitCode = errors.length ? 1 : 0;
