import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const aptDownloadLimits = [
  'Acquire::Retries "2";',
  'Acquire::http::Timeout "30";',
  'Acquire::https::Timeout "30";',
  'DPkg::Lock::Timeout "60";',
  'APT::Update::Error-Mode "any";',
  ''
].join('\n');

/** Preserve source options and signing keys; only the affected Ubuntu mirror moves. */
export function rewriteAptSource(contents, format, mirrorFiles = new Set()) {
  let knownRepositories = 0;
  const uri = (value) => {
    if (value.startsWith('mirror+file:')) {
      if (format === 'mirrors')
        throw new Error('Nested APT mirror lists are not supported.');
      const file = new URL(value.slice('mirror+'.length));
      const pathname = posix.normalize(decodeURIComponent(file.pathname));
      if (
        file.host ||
        file.search ||
        file.hash ||
        !pathname.startsWith('/etc/apt/') ||
        /[\\\u0000-\u0020]/.test(pathname) ||
        /\.(?:gz|xz|bz2|lz4|zst)$/.test(pathname)
      )
        throw new Error('Unsupported local APT mirror list path.');
      mirrorFiles.add(pathname);
      return value;
    }
    if (
      /^https?:\/\/(?:azure\.archive|archive|security)\.ubuntu\.com\/ubuntu\/?$/.test(
        value
      )
    )
      ++knownRepositories;
    if (/^https?:\/\/azure\.archive\.ubuntu\.com(?:[/:?#]|$)/.test(value)) {
      if (!/^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?$/.test(value))
        throw new Error('Unsupported Azure Ubuntu archive path.');
      return value.replace(
        /^https?:\/\/azure\.archive\.ubuntu\.com/,
        'https://archive.ubuntu.com'
      );
    }
    return value;
  };
  let field = '';
  const rewritten = contents
    .split(/(?<=\n)/)
    .map((line) => {
      const body = line.replace(/\r?\n$/, '');
      if (!body.trim()) {
        field = '';
        return line;
      }
      if (body.trimStart().startsWith('#')) return line;
      if (format === 'sources') {
        const header = /^([A-Za-z0-9-]+):[ \t]*/.exec(body);
        if (header) field = header[1].toLowerCase();
        else if (!/^[ \t]/.test(body) || !field)
          throw new Error('Unsupported deb822 APT source format.');
        if (field !== 'uris') return line;
        const offset = header?.[0].length ?? 0;
        return line.slice(0, offset) + line.slice(offset).replace(/\S+/g, uri);
      }
      if (format === 'list') {
        const entry =
          /^(\s*deb(?:-src)?\s+(?:\[[^\]\r\n]*\]\s+)?)(\S+)([ \t]+\S+)/.exec(
            body
          );
        if (!entry) throw new Error('Unsupported one-line APT source format.');
        return (
          entry[1] +
          uri(entry[2]) +
          line.slice(entry[1].length + entry[2].length)
        );
      }
      if (format === 'mirrors')
        return line.replace(
          /^(\s*)(\S+)/,
          (_, spaces, value) => spaces + uri(value)
        );
      throw new Error('Unsupported APT source file format.');
    })
    .join('');
  return { contents: rewritten, knownRepositories };
}

function requireRegular(path, directory = false) {
  const stat = lstatSync(path);
  if (
    !(directory ? stat.isDirectory() : stat.isFile()) ||
    realpathSync(path) !== resolve(path)
  )
    throw new Error('APT preparation requires regular files and directories.');
  return stat;
}

function writeAtomically(path, contents) {
  const temporary = path + '.openg7-' + randomUUID() + '.tmp';
  try {
    const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o644;
    writeFileSync(temporary, contents, { flag: 'wx', mode });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** Build every change before writing; an unexpected image or source fails the job. */
export function prepareUbuntuApt({
  root = '/',
  platform = process.platform,
  apply = false
} = {}) {
  if (platform !== 'linux') throw new Error('APT preparation requires Linux.');
  const release = readFileSync(join(root, 'etc/os-release'), 'utf8');
  if (
    !/^ID=(?:ubuntu|"ubuntu")\r?$/m.test(release) ||
    !/^VERSION_ID=(?:24\.04|"24\.04")\r?$/m.test(release)
  )
    throw new Error('APT preparation requires Ubuntu 24.04.');
  const changes = new Map();
  const mirrors = new Set();
  let knownRepositories = 0;
  const transform = (relative, format, required = false) => {
    const path = join(root, relative);
    if (!existsSync(path)) {
      if (required) throw new Error('A referenced APT mirror list is missing.');
      return;
    }
    requireRegular(path);
    const original = readFileSync(path, 'utf8');
    const result = rewriteAptSource(original, format, mirrors);
    knownRepositories += result.knownRepositories;
    if (result.contents !== original) changes.set(path, result.contents);
  };
  transform('etc/apt/sources.list', 'list');
  const directory = join(root, 'etc/apt/sources.list.d');
  if (existsSync(directory)) {
    requireRegular(directory, true);
    for (const name of readdirSync(directory).sort()) {
      if (!/^[A-Za-z0-9_.-]+\.(list|sources)$/.test(name)) continue;
      transform(
        'etc/apt/sources.list.d/' + name,
        name.endsWith('.sources') ? 'sources' : 'list'
      );
    }
  }
  // Current GitHub images use this priority list behind mirror+file URIs.
  if (existsSync(join(root, 'etc/apt/apt-mirrors.txt')))
    mirrors.add('/etc/apt/apt-mirrors.txt');
  for (const path of mirrors) transform(path.slice(1), 'mirrors', true);
  if (!knownRepositories)
    throw new Error(
      'No supported Ubuntu archive was found in the runner sources.'
    );
  const config = join(root, 'etc/apt/apt.conf.d/99-openg7-ci-downloads');
  requireRegular(join(root, 'etc/apt/apt.conf.d'), true);
  if (existsSync(config)) requireRegular(config);
  if (!existsSync(config) || readFileSync(config, 'utf8') !== aptDownloadLimits)
    changes.set(config, aptDownloadLimits);
  if (apply)
    for (const [path, contents] of changes) writeAtomically(path, contents);
  return [...changes.keys()];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length > 1 ||
      args.some((arg) => !['--apply', '--dry-run'].includes(arg))
    )
      throw new Error('Usage: prepare-ubuntu-apt.mjs [--apply|--dry-run]');
    const apply = process.argv.includes('--apply');
    const changed = prepareUbuntuApt({ apply });
    console.log(
      `${apply ? 'Prepared' : 'Would prepare'} Ubuntu APT: ${changed.length} file(s).`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
