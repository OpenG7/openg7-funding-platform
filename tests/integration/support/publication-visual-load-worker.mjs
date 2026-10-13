import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import pg from 'pg';
import sharp from 'sharp';

import { processSponsorImage } from '../../../dist/apps/funding-api/src/sponsor-image.service.js';
import { PublicationAutomationService } from '../../../dist/apps/funding-api/src/publication-automation/service.js';
import { resolvePublicationVisual } from '../../../dist/apps/funding-api/src/publication-automation/visuals.js';
import { withPostgresTransaction } from '../../../dist/apps/funding-api/src/postgres-transaction.js';
import { profilePublicationPool } from './publication-query-profile.mjs';
import {
  visualLoadStorage,
  visualLoadEnv,
  visualLoadActor
} from './publication-visual-load-fixture.mjs';
import {
  syntheticHighResolutionPhoto,
  sha256,
  VISUAL_LOAD_PHOTO_COUNT
} from './publication-visual-load-images.mjs';

const round = (value) => Math.round(value * 100) / 100;
const safeErrorCode = (error) =>
  /^[A-Z0-9_]+$/.test(error?.code ?? '')
    ? error.code
    : 'VISUAL_LOAD_WORKER_FAILED';
const send = (message) =>
  new Promise((resolve, reject) => {
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
const publicManifest = (snapshot) => ({
  format: snapshot.format,
  sources: snapshot.sources.map((source) => ({
    contributionId: source.contributionId,
    assetId: source.media.id,
    assetVersion: source.media.version,
    sourceHash: source.media.hash
  })),
  images:
    snapshot.images?.map((image) => ({
      contributionId: image.contributionId,
      assetId: image.assetId,
      sha256: image.derivedHash,
      width: image.width,
      height: image.height
    })) ?? []
});

// The only transport is parent/child IPC; credentials and private paths never
// enter command arguments, environment overrides, console output or the report.
process.once('message', async (input) => {
  let pool;
  let sample;
  const originalToBuffer = sharp.prototype.toBuffer;
  let measuring = false;
  const reads = { count: 0, bytes: 0 };
  const encodings = {
    count: 0,
    jpeg: 0,
    png: 0,
    webp: 0,
    bytes: 0,
    inFlight: 0,
    maxInFlight: 0
  };
  let externalRequests = 0;
  globalThis.fetch = () => {
    externalRequests++;
    throw new Error('Visual load reception must never contact a provider');
  };
  try {
    const nativeStorage = visualLoadStorage(input.storageRoot);
    const storage = new Proxy(nativeStorage, {
      get(target, key) {
        if (key === 'readPrivateObject')
          return async (...args) => {
            const bytes = await target.readPrivateObject(...args);
            if (measuring) {
              reads.count++;
              reads.bytes += bytes?.length ?? 0;
            }
            return bytes;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    // Transparent instrumentation of the public native encode method. Every
    // original Sharp operation still runs with its untouched options and bytes.
    sharp.prototype.toBuffer = function (...args) {
      if (!measuring) return originalToBuffer.apply(this, args);
      assert.ok(
        !args.some((argument) => typeof argument === 'function'),
        'The measured runtime uses Promise-based encodes'
      );
      encodings.count++;
      encodings.inFlight++;
      encodings.maxInFlight = Math.max(
        encodings.maxInFlight,
        encodings.inFlight
      );
      return originalToBuffer
        .apply(this, args)
        .then((result) => {
          const bytes = Buffer.isBuffer(result) ? result : result.data;
          encodings.bytes += bytes.length;
          if (bytes[0] === 0xff && bytes[1] === 0xd8) encodings.jpeg++;
          else if (bytes[0] === 0x89 && bytes[1] === 0x50) encodings.png++;
          else if (bytes.toString('ascii', 0, 4) === 'RIFF') encodings.webp++;
          return result;
        })
        .finally(() => {
          encodings.inFlight--;
        });
    };
    let operation;
    let profile;
    if (input.operation === 'ingestion') {
      operation = async () => {
        const photographs = [];
        for (let index = 0; index < VISUAL_LOAD_PHOTO_COUNT; index++) {
          // Generation is recorded separately; only real ingestion is counted
          // in the normalisation totals below. Whole-child RSS includes both.
          const generatedAt = performance.now();
          const { bytes: original, quality: originalQuality } =
            await syntheticHighResolutionPhoto(index);
          const generationMs = performance.now() - generatedAt;
          measuring = true;
          const started = performance.now();
          const cpu = process.cpuUsage();
          const image = await processSponsorImage({
            data: original,
            kind: 'supporting_image',
            originalFilename: `synthetic-${index}.jpg`
          });
          const used = process.cpuUsage(cpu);
          const ingestionMs = performance.now() - started;
          measuring = false;
          assert.ok(image.width <= 2000 && image.height <= 2000);
          assert.ok(image.processedData.length <= 8 * 1024 * 1024);
          const processedKey = `visual-load/ingestion/${index}/processed.webp`;
          const originalKey = `visual-load/ingestion/${index}/original.jpg`;
          await storage.writePrivateObject({
            key: originalKey,
            data: original,
            contentType: 'image/jpeg'
          });
          await storage.writePrivateObject({
            key: processedKey,
            data: image.processedData,
            contentType: 'image/webp'
          });
          photographs.push({
            originalKey,
            processedKey,
            originalQuality,
            originalBytes: original.length,
            originalHash: sha256(original),
            processedBytes: image.processedData.length,
            processedHash: image.checksumSha256,
            processedWidth: image.width,
            processedHeight: image.height,
            generationMs: round(generationMs),
            ingestionMs: round(ingestionMs),
            ingestionCpuMs: round((used.user + used.system) / 1000)
          });
        }
        return { photographs };
      };
    } else {
      assert.equal(input.database.host, '127.0.0.1');
      pool = new pg.Pool({ ...input.database, max: 10 });
      profile = profilePublicationPool(pool);
      const service = new PublicationAutomationService(
        profile.port,
        storage,
        visualLoadEnv
      );
      operation = async () => {
        if (input.operation === 'compose') {
          const result = await service.command(input.command, visualLoadActor);
          const row = (
            await pool.query(
              'SELECT id,version,media_snapshot FROM publication_deliveries WHERE id=$1',
              [result.id]
            )
          ).rows[0];
          assert.ok(row?.media_snapshot);
          return {
            deliveryId: row.id,
            version: row.version,
            hashes: row.media_snapshot.images?.map(
              (image) => image.derivedHash
            ) ?? [row.media_snapshot.derivedHash],
            manifest: publicManifest(row.media_snapshot)
          };
        }
        if (input.operation === 'resolve') {
          return withPostgresTransaction(profile.port, async (db) => {
            const row = (
              await db.query(
                'SELECT * FROM publication_deliveries WHERE id=$1 FOR SHARE',
                [input.deliveryId]
              )
            ).rows[0];
            const visual = await resolvePublicationVisual(
              db,
              storage,
              row,
              false,
              true
            );
            assert.deepEqual(visual.snapshot, row.media_snapshot);
            const images =
              visual.prepared?.kind === 'collection'
                ? visual.prepared.images
                : [visual.prepared];
            assert.ok(images.every(Boolean));
            for (const image of images) {
              assert.equal(image.mimeType, 'image/jpeg');
              assert.equal(sha256(image.bytes), image.sha256);
            }
            return {
              hashes: images.map((image) => image.sha256),
              manifest: publicManifest(visual.snapshot),
              outputBytes: images.reduce(
                (sum, image) => sum + image.bytes.length,
                0
              )
            };
          });
        }
        const indexes =
          input.operation === 'gallery'
            ? Array.from({ length: 10 }, (_, index) => index)
            : [input.imageIndex ?? 0];
        assert.ok(['gallery', 'preview'].includes(input.operation));
        // Exactly the Web gallery's Promise.all fan-out, not ten serial reads.
        const images = await Promise.all(
          indexes.map((index) =>
            service.imagePreview(input.deliveryId, input.version, index)
          )
        );
        assert.equal(images.length, indexes.length);
        for (const [offset, image] of images.entries()) {
          assert.equal(image.mimeType, 'image/jpeg');
          assert.equal(sha256(image.bytes), image.sha256);
          assert.equal(image.sha256, input.expectedHashes[indexes[offset]]);
        }
        return {
          hashes: images.map((image) => image.sha256),
          outputBytes: images.reduce(
            (sum, image) => sum + image.bytes.length,
            0
          )
        };
      };
    }
    const rssBefore = process.memoryUsage().rss;
    let sampledPeak = rssBefore;
    sample = setInterval(() => {
      sampledPeak = Math.max(sampledPeak, process.memoryUsage().rss);
    }, 10);
    const started = performance.now();
    const cpu = process.cpuUsage();
    measuring = input.operation !== 'ingestion';
    const result = profile
      ? await profile.measure(input.phase, operation)
      : await operation();
    measuring = false;
    const used = process.cpuUsage(cpu);
    sampledPeak = Math.max(sampledPeak, process.memoryUsage().rss);
    clearInterval(sample);
    assert.equal(externalRequests, 0);
    assert.equal(encodings.inFlight, 0);
    const metrics = {
      phase: input.phase,
      elapsedMs: round(performance.now() - started),
      cpuMs: round((used.user + used.system) / 1000),
      rssBeforeBytes: rssBefore,
      rssAfterBytes: process.memoryUsage().rss,
      rssSampledPeakBytes: sampledPeak,
      processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
      privateReads: reads.count,
      privateReadBytes: reads.bytes,
      encodings: {
        count: encodings.count,
        jpeg: encodings.jpeg,
        png: encodings.png,
        webp: encodings.webp,
        outputBytes: encodings.bytes,
        maxInFlight: encodings.maxInFlight
      },
      externalRequests,
      sql: profile?.measurements[0] ?? null,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        sharp: sharp.versions.sharp,
        vips: sharp.versions.vips,
        sharpConcurrency: sharp.concurrency(),
        sharpCache: sharp.cache()
      }
    };
    if (input.operation === 'gallery' || input.operation === 'preview') {
      // Oracle-only metadata read follows the measured service calls. It adds
      // neither a render nor a source read to their performance counters.
      const row = (
        await pool.query(
          'SELECT media_snapshot FROM publication_deliveries WHERE id=$1',
          [input.deliveryId]
        )
      ).rows[0];
      result.manifest = publicManifest(row.media_snapshot);
    }
    await pool?.end();
    pool = null;
    await send({ ok: true, metrics, result });
  } catch (error) {
    clearInterval(sample);
    await pool?.end().catch(() => undefined);
    await send({ ok: false, errorCode: safeErrorCode(error) });
  } finally {
    sharp.prototype.toBuffer = originalToBuffer;
    process.disconnect();
  }
});
