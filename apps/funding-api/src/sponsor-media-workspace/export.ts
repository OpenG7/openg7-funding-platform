import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Pool } from 'pg';
import type { SponsorMediaExportRequest } from '@openg7/funding-core';

import { isJsonContentType } from '../http-routing.js';
import type { createHttpTransport, readBody } from '../http-transport.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { getSponsorMediaStorageRecord } from '../sponsor-media/persistence-read.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';

import {
  ensure,
  bounded,
  validId,
  fingerprint,
  lockWorkspace,
  replay,
  record,
  MediaWorkspaceError
} from './policy.js';
import { attestMediaSources } from './source-attestation.js';

export function validateMediaExport(
  value: unknown
): asserts value is SponsorMediaExportRequest {
  ensure(
    value && typeof value === 'object' && !Array.isArray(value),
    'INVALID_MEDIA_EXPORT',
    400
  );
  const input = value as Record<string, unknown>;
  ensure(
    Object.keys(input).length === 5 &&
      Object.keys(input).every((key) =>
        [
          'requestId',
          'contributionId',
          'assetId',
          'expectedVersion',
          'confirmation'
        ].includes(key)
      ) &&
      validId(input.requestId) &&
      validId(input.contributionId) &&
      validId(input.assetId) &&
      bounded(input.expectedVersion, 1, 128) &&
      input.confirmation === input.assetId,
    'INVALID_MEDIA_EXPORT',
    400
  );
}

/** Audit preparation of one private derivative; receiving these bytes is not a publication. */
export class SponsorMediaExportService {
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<SponsorMediaStorage, 'readPrivateObject'>
  ) {}

  async export(input: SponsorMediaExportRequest, actor: string) {
    validateMediaExport(input);
    const asset = await getSponsorMediaStorageRecord(this.pool, input.assetId);
    ensure(
      asset?.contributionId === input.contributionId,
      'MEDIA_NOT_FOUND',
      404
    );
    ensure(asset.version === input.expectedVersion, 'MEDIA_VERSION_CONFLICT');
    const source: { bytes: Buffer | null } = { bytes: null };
    const attestation = (
      await attestMediaSources(
        this.pool,
        {
          readPrivateObject: async (key) => {
            source.bytes = await this.storage.readPrivateObject(key);
            return source.bytes;
          }
        },
        input.contributionId,
        [input.assetId]
      )
    ).get(input.assetId);
    ensure(
      source.bytes && attestation?.valid,
      'MEDIA_CONTENT_UNAVAILABLE',
      503
    );
    ensure(
      attestation.version === input.expectedVersion,
      'MEDIA_VERSION_CONFLICT'
    );
    const hash = fingerprint({ action: 'export', input });
    await withPostgresTransaction(this.pool, async (db) => {
      await lockWorkspace(db, input.contributionId);
      const current = (
        await db.query<{ version: string; checksum: string }>(
          `SELECT updated_at::text AS version,checksum_sha256 AS checksum FROM sponsor_media_assets
          WHERE id=$1::uuid AND contribution_id=$2::uuid AND deleted_at IS NULL FOR SHARE`,
          [input.assetId, input.contributionId]
        )
      ).rows[0];
      ensure(current, 'MEDIA_NOT_FOUND', 404);
      ensure(
        current.version === input.expectedVersion &&
          current.checksum === attestation.checksum,
        'MEDIA_VERSION_CONFLICT'
      );
      if (await replay(db, input.contributionId, input.requestId, hash, actor))
        return;
      await record(
        db,
        input.contributionId,
        input.requestId,
        hash,
        actor,
        'export',
        {
          assetId: input.assetId,
          version: input.expectedVersion,
          status: 'prepared',
          mimeType: 'image/webp',
          checksum: current.checksum
        }
      );
    });
    return {
      bytes: source.bytes,
      mimeType: 'image/webp' as const,
      filename: `media-${input.assetId}.webp`,
      checksum: attestation.checksum
    };
  }
}

interface Dependencies {
  readonly publicBaseOrigin: string;
  readonly service: Pick<SponsorMediaExportService, 'export'> | null;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly canReview: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBody: typeof readBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly writeBinary: ReturnType<typeof createHttpTransport>['writeBinary'];
}
export function createSponsorMediaExportHttpHandler(deps: Dependencies) {
  return async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> => {
    const url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    if (
      url.pathname.replace(/^\/api(?=\/)/, '') !==
      '/admin/sponsorships/media/export'
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    try {
      ensure(deps.canReview(request), 'MEDIA_EXPORT_REVIEWER_REQUIRED', 403);
      ensure(request.method === 'POST', 'METHOD_NOT_ALLOWED', 405);
      ensure(
        !url.search && isJsonContentType(request.headers['content-type']),
        'JSON_REQUIRED',
        415
      );
      const input: unknown = JSON.parse(await deps.readBody(request, 8 * 1024));
      validateMediaExport(input);
      ensure(deps.service, 'MEDIA_EXPORT_UNAVAILABLE', 503);
      const result = await deps.service.export(
        input,
        deps.getAdminAuditActor(request)
      );
      deps.writeBinary(request, response, 200, result.bytes, result.mimeType, {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'X-Content-SHA256': result.checksum
      });
    } catch (error) {
      const known = error instanceof MediaWorkspaceError;
      deps.writeJson(
        request,
        response,
        known ? error.status : error instanceof SyntaxError ? 400 : 503,
        {
          code: known
            ? error.code
            : error instanceof SyntaxError
              ? 'INVALID_MEDIA_EXPORT'
              : 'MEDIA_EXPORT_UNAVAILABLE'
        }
      );
    }
    return true;
  };
}
