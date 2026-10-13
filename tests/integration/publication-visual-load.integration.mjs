import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { seedVisualLoadFixture } from './support/publication-visual-load-fixture.mjs';
import {
  VISUAL_LOAD_PHOTO_COUNT,
  VISUAL_LOAD_ORIGINAL_WIDTH,
  VISUAL_LOAD_ORIGINAL_HEIGHT
} from './support/publication-visual-load-images.mjs';

const worker = fileURLToPath(
  new URL('./support/publication-visual-load-worker.mjs', import.meta.url)
);
const activeChildren = new Set();

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    const stopped = (confirmed) => {
      clearTimeout(guard);
      child.off('exit', exited);
      child.off('close', exited);
      resolve(confirmed);
    };
    const exited = () => stopped(true);
    const guard = setTimeout(() => stopped(false), 5000);
    child.once('exit', exited);
    child.once('close', exited);
    // This process belongs only to the fixture. Cleanup must remain bounded
    // even if the IPC channel failed while its worker was still running.
    try {
      child.kill('SIGKILL');
    } catch {
      // The exit/close listeners or bounded wait finish cleanup safely.
    }
  });
}

async function stopChildren() {
  const stopped = await Promise.all([...activeChildren].map(stopChild));
  if (stopped.some((confirmed) => !confirmed) || activeChildren.size !== 0)
    throw new Error('VISUAL_LOAD_CHILD_CLEANUP_FAILED');
}

async function isolatedPhase(input) {
  return new Promise((resolve, reject) => {
    const child = fork(worker, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
      execArgv: []
    });
    activeChildren.add(child);
    let response;
    let failure;
    let stopping = false;
    // Do not echo unfiltered child stderr: it could contain a private path.
    child.stderr.resume();
    const failAndStop = (code) => {
      failure ??= new Error(`${input.phase}: ${code}`);
      if (stopping) return;
      stopping = true;
      void stopChild(child).then((confirmed) =>
        reject(
          confirmed
            ? failure
            : new Error(`${input.phase}: VISUAL_LOAD_CHILD_STOP_UNCONFIRMED`)
        )
      );
    };
    const guard = setTimeout(
      () => failAndStop('VISUAL_LOAD_CHILD_TIMEOUT'),
      180000
    );
    guard.unref();
    child.on('message', (message) => {
      response = message;
    });
    child.on('error', () => {
      failAndStop('VISUAL_LOAD_CHILD_IPC_FAILED');
    });
    const exited = (code) => {
      clearTimeout(guard);
      activeChildren.delete(child);
      if (failure) reject(failure);
      else if (code !== 0 || !response?.ok)
        reject(
          new Error(
            `${input.phase}: ${response?.errorCode ?? 'VISUAL_LOAD_CHILD_FAILED'}`
          )
        );
      else resolve(response);
    };
    child.once('exit', exited);
    child.once('close', exited);
    try {
      child.send(input, (error) => {
        if (error) failAndStop('VISUAL_LOAD_CHILD_IPC_FAILED');
      });
    } catch {
      failAndStop('VISUAL_LOAD_CHILD_IPC_FAILED');
    }
  });
}

test(
  'isolated visual-load phase stops its worker after synchronous IPC serialization failure',
  { timeout: 10000 },
  async (t) => {
    t.after(stopChildren);
    const input = {
      operation: 'synthetic_ipc_failure',
      phase: 'synthetic_ipc_failure'
    };
    input.circular = input;
    await assert.rejects(isolatedPhase(input), {
      message: 'synthetic_ipc_failure: VISUAL_LOAD_CHILD_IPC_FAILED'
    });
    assert.equal(activeChildren.size, 0, 'The failed worker must have exited');
  }
);

test(
  'ten large photographs traverse real ingestion, exact private previews and concurrent gallery without publishing',
  { timeout: 600000 },
  async (t) => {
    const label = process.env.FUNDING_VISUAL_LOAD_REPORT ?? 'current';
    assert.ok(
      ['baseline', 'current'].includes(label),
      'Choose a fixed safe report label'
    );
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'og7-visual-load-'));
    let database;
    t.after(async () => {
      try {
        await stopChildren();
      } finally {
        try {
          await database?.stop();
        } finally {
          // A worker whose termination was not confirmed may still use these
          // objects. Keep them rather than report a successful cleanup.
          if (activeChildren.size === 0) {
            assert.ok(
              path
                .resolve(storageRoot)
                .startsWith(
                  path.resolve(tmpdir()) + path.sep + 'og7-visual-load-'
                )
            );
            await rm(storageRoot, { recursive: true, force: true });
          }
        }
      }
    });
    const report = {
      schemaVersion: 1,
      label,
      generatedAt: new Date().toISOString(),
      scope:
        'synthetic-private-local-storage-disposable-postgresql-no-provider',
      fixture: {
        photographs: VISUAL_LOAD_PHOTO_COUNT,
        originalWidth: VISUAL_LOAD_ORIGINAL_WIDTH,
        originalHeight: VISUAL_LOAD_ORIGINAL_HEIGHT,
        maxUploadBytes: 8 * 1024 * 1024,
        maxInputPixels: 40000000,
        processedMaxDimension: 2000
      },
      phases: [],
      limits: {
        timing: 'informational, no hardware-dependent latency threshold',
        rss: 'sampled phase peak plus whole fresh-process high-water; ingestion process includes synthetic generation',
        storage:
          'real local disk reads allocate fresh Buffers; filesystem cache is not forcibly cold',
        provider: 'no HTTP/provider/SMTP, no approval, dispatch or fulfilment',
        concurrency: 'one gallery opens ten real service calls with Promise.all'
      }
    };
    const ingestion = await isolatedPhase({
      operation: 'ingestion',
      phase: 'ingestion',
      storageRoot
    });
    report.phases.push(ingestion.metrics);
    const photographs = ingestion.result.photographs;
    assert.equal(photographs.length, 10);
    assert.equal(
      new Set(photographs.map((photo) => photo.processedHash)).size,
      10
    );
    report.fixture.photographsDetails = photographs.map((photo) => ({
      originalQuality: photo.originalQuality,
      originalBytes: photo.originalBytes,
      originalHash: photo.originalHash,
      processedBytes: photo.processedBytes,
      processedHash: photo.processedHash,
      processedWidth: photo.processedWidth,
      processedHeight: photo.processedHeight,
      generationMs: photo.generationMs,
      ingestionMs: photo.ingestionMs,
      ingestionCpuMs: photo.ingestionCpuMs
    }));
    database = await startDisposablePostgres();
    const connection = {
      host: database.pool.options.host,
      port: database.pool.options.port,
      database: database.pool.options.database,
      user: database.pool.options.user,
      password: database.pool.options.password,
      ssl: false,
      options: '',
      connectionTimeoutMillis: 1000
    };
    const measure = async (operation, phase, extra) => {
      const response = await isolatedPhase({
        operation,
        phase,
        storageRoot,
        database: connection,
        ...extra
      });
      report.phases.push(response.metrics);
      return response.result;
    };
    for (const format of ['image_collection', 'collective_composite']) {
      const command = await seedVisualLoadFixture(
        database.pool,
        storageRoot,
        photographs,
        format
      );
      const composed = await measure('compose', format + '_compose', {
        command
      });
      const expectedSources = command.photoSelections.map((photo, index) => ({
        contributionId: photo.contributionId,
        assetId: photo.assetId,
        assetVersion: photo.assetVersion,
        sourceHash: photographs[index].processedHash
      }));
      assert.equal(composed.manifest.format, format);
      assert.deepEqual(composed.manifest.sources, expectedSources);
      if (format === 'image_collection') {
        assert.equal(
          new Set(composed.hashes).size,
          10,
          'Each approved owner must have its distinct real JPEG'
        );
        assert.deepEqual(
          composed.manifest.images,
          command.photoSelections.map((photo, index) => ({
            contributionId: photo.contributionId,
            assetId: photo.assetId,
            sha256: composed.hashes[index],
            width: photographs[index].processedWidth,
            height: photographs[index].processedHeight
          }))
        );
      }
      const scope = {
        deliveryId: composed.deliveryId,
        version: composed.version,
        expectedHashes: composed.hashes
      };
      const resolved = await measure('resolve', format + '_resolve', scope);
      assert.deepEqual(resolved.hashes, composed.hashes);
      assert.deepEqual(resolved.manifest, composed.manifest);
      const preview = await measure(
        'preview',
        format + '_preview_index0',
        scope
      );
      assert.deepEqual(preview.hashes, [composed.hashes[0]]);
      assert.deepEqual(preview.manifest, composed.manifest);
      if (format === 'image_collection') {
        assert.equal(composed.hashes.length, 10);
        const gallery = await measure(
          'gallery',
          format + '_gallery_concurrent10',
          scope
        );
        assert.deepEqual(gallery.hashes, composed.hashes);
        assert.deepEqual(gallery.manifest, composed.manifest);
        assert.equal(new Set(gallery.hashes).size, 10);
        report.collectionJpegHashes = gallery.hashes;
      } else report.compositeJpegHash = preview.hashes[0];
    }
    // Baseline remains reproducible. Current reception requires exactly one
    // source read and technical JPEG per owner, including all ten gallery calls.
    for (const phase of report.phases.filter(
      (phase) => phase.phase !== 'ingestion'
    )) {
      const gallery = phase.phase.endsWith('gallery_concurrent10');
      if (label === 'current') {
        assert.equal(phase.privateReads, gallery ? 100 : 10, phase.phase);
        assert.equal(
          phase.encodings.jpeg,
          gallery ? 100 : phase.phase.startsWith('image_collection') ? 10 : 11,
          phase.phase
        );
      }
      assert.ok(
        phase.privateReads > 0 && phase.privateReads <= (gallery ? 200 : 20)
      );
      assert.ok(
        phase.encodings.jpeg > 0 && phase.encodings.jpeg <= (gallery ? 200 : 20)
      );
      assert.ok(phase.sql.queryCount <= (gallery ? 3000 : 300));
      assert.equal(phase.sql.failedQueries, 0);
      assert.equal(phase.externalRequests, 0);
    }
    const state = (
      await database.pool.query(`SELECT
    (SELECT count(*)::int FROM fund_contributions) AS dossiers,
    (SELECT count(*)::int FROM sponsorship_obligations WHERE state='pending') AS pending,
    (SELECT count(*)::int FROM sponsorship_fulfilment_evidence) AS proofs,
    (SELECT count(*)::int FROM publication_deliveries WHERE status='draft' AND approved_at IS NULL) AS private_deliveries,
    (SELECT count(*)::int FROM publication_deliveries WHERE status<>'draft' OR approved_at IS NOT NULL) AS authorised_or_sent,
    (SELECT count(*)::int FROM publication_account_reservations) AS dispatch_reservations`)
    ).rows[0];
    assert.deepEqual(state, {
      dossiers: 20,
      pending: 20,
      proofs: 0,
      private_deliveries: 2,
      authorised_or_sent: 0,
      dispatch_reservations: 0
    });
    report.unchangedAuthority = state;
    await mkdir('test-results', { recursive: true });
    await writeFile(
      `test-results/publication-visual-load-${label}.json`,
      JSON.stringify(report, null, 2) + '\n'
    );
  }
);
