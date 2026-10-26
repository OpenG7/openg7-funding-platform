import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const limits = {
  images: 240,
  imageBytes: 8 * 1024 ** 2,
  totalBytes: 200 * 1024 ** 2
};
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const text = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const escapeHtml = (value) =>
  String(value ?? 'Inconnu').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]
  );
const relative = (value) =>
  path.relative(root, value).split(path.sep).join('/');

function within(parent, target) {
  const value = path.relative(parent, target);
  if (
    value === '..' ||
    value.startsWith(`..${path.sep}`) ||
    path.isAbsolute(value)
  )
    throw new Error('An artifact path leaves its permitted local directory.');
}

async function fileIn(candidate, directory, maxBytes) {
  const resolved = await realpath(candidate);
  within(directory, resolved);
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.size > maxBytes)
    throw new Error('An artifact is not a regular file within the size limit.');
  return { resolved, size: stat.size };
}

async function directoryIn(parent, name) {
  const target = path.join(parent, name);
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('A gallery directory must be a regular local directory.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(target);
  }
  const resolved = await realpath(target);
  within(parent, resolved);
  return resolved;
}

async function writeLocal(file, content, directory) {
  within(directory, file);
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error('A gallery output must be a regular local file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(file, content, 'utf8');
}

function collect(suites, parents = []) {
  return suites.flatMap((suite) => {
    const titles = [...parents, suite.title].filter(Boolean);
    return [
      ...(suite.specs ?? []).flatMap((spec) =>
        (spec.tests ?? []).map((test) => ({
          scenario: [...titles, spec.title].join(' › '),
          project: text(test.projectName),
          expectedStatus: test.expectedStatus,
          outcome: test.status,
          result: test.results?.at(-1)
        }))
      ),
      ...collect(suite.suites ?? [], titles)
    ];
  });
}

async function metadataFor(attachment, result, input) {
  const description = result.attachments?.find(
    (item) =>
      item.name === `${attachment.name}-metadata` &&
      item.contentType === 'application/json'
  );
  if (!description?.path) return {};
  const file = await fileIn(
    path.resolve(root, description.path),
    input,
    64 * 1024
  );
  const metadata = JSON.parse(await readFile(file.resolved, 'utf8'));
  if (metadata.version !== 1 || metadata.captureName !== attachment.name)
    throw new Error('Capture metadata does not match its PNG attachment.');
  return metadata;
}

function html(manifest) {
  const { summary, run } = manifest;
  const cards = manifest.captures
    .map(
      (capture) => `<article>
    <h2>${escapeHtml(capture.name)}</h2>
    <p>${escapeHtml(capture.scenario)}</p>
    <p>${escapeHtml(capture.project)} · ${escapeHtml(capture.language)} · ${capture.viewport ? `${capture.viewport.width} × ${capture.viewport.height} CSS px` : 'Viewport inconnu'}</p>
    <p>Accès : ${escapeHtml(capture.access)} · Portée : ${escapeHtml(capture.scope)}</p>
    <a href="${capture.image}" target="_blank" rel="noopener"><img loading="lazy" src="${capture.image}" alt="${escapeHtml(capture.name)} — ${escapeHtml(capture.scenario)}" /></a>
    <p><a href="${capture.image}">Ouvrir le PNG intact</a> · résultat : réussi · ${capture.bytes} octets</p>
    ${capture.missing.length ? `<p>Champs inconnus : ${escapeHtml(capture.missing.join(', '))}.</p>` : ''}
  </article>`
    )
    .join('\n');
  return `<!doctype html>
<html lang="fr-CA"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Réception visuelle OpenG7 — publications</title>
<style>body{margin:0;background:#f4f7fb;color:#143052;font:16px/1.6 system-ui,sans-serif}main{max-width:100rem;margin:auto;padding:1.5rem}a{color:#0759b9}a:focus-visible{outline:3px solid #926c00;outline-offset:3px}h1,h2{line-height:1.25;overflow-wrap:anywhere}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,32rem),1fr));gap:1.5rem}article,.intro{background:white;border:1px solid #cad5e5;border-radius:1rem;padding:1.25rem;min-width:0}img{display:block;width:100%;height:auto;border:1px solid #cad5e5;box-sizing:border-box}code{overflow-wrap:anywhere}article p{overflow-wrap:anywhere}.warning{font-weight:650;color:#805b00}</style></head>
<body><main><h1>Réception visuelle des publications OpenG7</h1><div class="intro">
<p>Commit déclaré au lancement : <code>${escapeHtml(run.commit)}</code> · arbre : ${escapeHtml(run.workingTree)}. Généré le ${escapeHtml(manifest.generatedAt)}.</p>
<p>${summary.passed} scénario(s) réussi(s) sur ${summary.tests} ; ${summary.capturedTests} scénario(s) illustré(s), ${summary.images} capture(s). ${summary.failed} échec(s), ${summary.flaky} instable(s), ${summary.skipped} ignoré(s), ${summary.unknown} résultat(s) inconnu(s), ${summary.runErrors} erreur(s) d’exécution.</p>
<p class="warning">Cette galerie contient seulement les PNG explicitement attachés à un scénario réussi. Tous les succès n’ont pas forcément une image. Les captures ne qualifient ni un fournisseur réel, ni une manette physique, ni Windows à 125 %.</p>
<p>Portée du rapport : ${escapeHtml(run.scope)}. ${summary.omitted} attache(s) PNG omise(s). <a href="manifest.json">Consulter le manifeste JSON et les champs absents</a>.</p>
</div><div class="gallery">${cards}</div></main></body></html>\n`;
}

async function main() {
  if (process.argv.length > 2)
    throw new Error(
      'This command uses the fixed publication-review input and output directories.'
    );
  const repo = await realpath(root);
  const results = await realpath(path.join(root, 'test-results'));
  if (path.relative(path.join(repo, 'test-results'), results) !== '')
    throw new Error('test-results must remain inside this repository.');
  const input = await realpath(path.join(results, 'publication-review'));
  within(results, input);
  const reportFile = await fileIn(
    path.join(input, 'results.json'),
    input,
    32 * 1024 ** 2
  );
  const report = JSON.parse(await readFile(reportFile.resolved, 'utf8'));
  if (!Array.isArray(report.suites))
    throw new Error('A Playwright JSON report is required.');
  const tests = collect(report.suites);
  const passed = tests.filter(
    (test) =>
      test.expectedStatus === 'passed' &&
      test.outcome === 'expected' &&
      test.result?.status === 'passed'
  );
  const declared = report.config?.metadata?.publicationReview ?? {};
  const run = {
    commit: /^[a-f\d]{40}$/i.test(declared.commit ?? '')
      ? declared.commit
      : null,
    workingTree: ['clean', 'modified'].includes(declared.workingTree)
      ? declared.workingTree
      : null,
    scope: declared.scope === 'synthetic-api-fixtures' ? declared.scope : null
  };
  const candidates = [];
  let omitted = tests
    .filter((test) => !passed.includes(test))
    .reduce(
      (sum, test) =>
        sum +
        (test.result?.attachments ?? []).filter(
          (attachment) => attachment.contentType === 'image/png'
        ).length,
      0
    );
  for (const test of passed) {
    for (const attachment of test.result.attachments ?? []) {
      if (attachment.contentType !== 'image/png') continue;
      if (
        !attachment.path ||
        !text(attachment.name) ||
        /test-failed|^screenshot$/i.test(attachment.name) ||
        /test-failed|^screenshot(?:-\d+)?\.png$/i.test(
          path.basename(attachment.path)
        )
      ) {
        omitted++;
        continue;
      }
      if (!/^[\w.-]+\.png$/i.test(path.basename(attachment.path))) {
        omitted++;
        continue;
      }
      const source = await fileIn(
        path.resolve(root, attachment.path),
        input,
        limits.imageBytes
      );
      candidates.push({ test, attachment, source });
    }
  }
  if (!candidates.length)
    throw new Error(
      'No explicitly attached PNG from a successful test was found.'
    );
  if (
    candidates.length > limits.images ||
    candidates.reduce((sum, item) => sum + item.source.size, 0) >
      limits.totalBytes
  )
    throw new Error(
      'Gallery copy limits exceeded; narrow the reviewed test selection.'
    );
  const output = await directoryIn(results, 'publication-review-gallery');
  const assets = await directoryIn(output, 'images');
  const captures = [];
  let copiedBytes = 0;
  for (const { test, attachment, source } of candidates) {
    const metadata = await metadataFor(attachment, test.result, input);
    const bytes = await readFile(source.resolved);
    copiedBytes += bytes.length;
    if (bytes.length > limits.imageBytes || copiedBytes > limits.totalBytes)
      throw new Error('Capture size changed beyond the gallery copy limits.');
    if (!bytes.subarray(0, 8).equals(pngSignature))
      throw new Error('A capture is not a PNG.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const target = path.join(assets, `${sha256}.png`);
    try {
      await copyFile(source.resolved, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fileIn(target, assets, limits.imageBytes);
      if (
        createHash('sha256')
          .update(await readFile(existing.resolved))
          .digest('hex') !== sha256
      )
        throw new Error(
          'An existing gallery image differs from its content hash.'
        );
    }
    const copied = await fileIn(target, assets, limits.imageBytes);
    if (
      createHash('sha256')
        .update(await readFile(copied.resolved))
        .digest('hex') !== sha256
    )
      throw new Error('A capture changed while it was being copied.');
    const viewport = metadata.viewport;
    const capture = {
      name: attachment.name,
      scenario: test.scenario,
      project: test.project,
      language: text(metadata.language),
      viewport:
        Number.isFinite(viewport?.width) &&
        viewport.width > 0 &&
        Number.isFinite(viewport?.height) &&
        viewport.height > 0
          ? { width: viewport.width, height: viewport.height }
          : null,
      access: text(metadata.access),
      scope:
        metadata.scope === 'synthetic-api-fixtures'
          ? metadata.scope
          : run.scope,
      result: 'passed',
      source: relative(source.resolved),
      image: `images/${sha256}.png`,
      bytes: bytes.length,
      sha256
    };
    captures.push({
      ...capture,
      missing: ['language', 'viewport', 'access', 'scope'].filter(
        (field) => capture[field] === null
      )
    });
  }
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    report: relative(reportFile.resolved),
    run,
    missingRunFields: Object.entries(run)
      .filter(([, value]) => value === null)
      .map(([key]) => key),
    limits,
    summary: {
      tests: tests.length,
      passed: passed.length,
      failed: tests.filter((test) => test.outcome === 'unexpected').length,
      flaky: tests.filter((test) => test.outcome === 'flaky').length,
      skipped: tests.filter((test) => test.outcome === 'skipped').length,
      unknown: tests.filter(
        (test) =>
          !passed.includes(test) &&
          !['unexpected', 'flaky', 'skipped'].includes(test.outcome)
      ).length,
      runErrors: report.errors?.length ?? 0,
      capturedTests: new Set(
        captures.map((capture) => `${capture.project}\0${capture.scenario}`)
      ).size,
      images: captures.length,
      omitted
    },
    qualifications: {
      realProvider: 'not-qualified',
      physicalController: 'not-qualified',
      windows125Percent: 'not-qualified',
      actualBrowserZoom: 'not-qualified'
    },
    captures
  };
  await writeLocal(
    path.join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    output
  );
  await writeLocal(path.join(output, 'index.html'), html(manifest), output);
  process.stdout.write(
    `${manifest.summary.passed} successful tests; ${captures.length} captures. Open ${relative(path.join(output, 'index.html'))}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`Publication review gallery: ${error.message}\n`);
  process.exitCode = 1;
});
