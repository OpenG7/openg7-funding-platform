import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  parseMultipartBoundary,
  parseMultipartFormData
} from './http-multipart.js';
import type { createHttpTransport } from './http-transport.js';
import { SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES } from './sponsor-media-limits.js';
import {
  SponsorMediaUploadError,
  type SponsorMediaUploadService
} from './sponsor-media-upload.service.js';

export interface SponsorMediaUploadHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly canReview: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBodyBuffer: (
    request: IncomingMessage,
    maxBytes: number
  ) => Promise<Buffer>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly sponsorMediaMaxBytes: number;
  readonly mediaUpload: Pick<SponsorMediaUploadService, 'upload'> | null;
}
export function createSponsorMediaUploadHttpHandler(
  deps: SponsorMediaUploadHttpDependencies
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    } catch {
      return false;
    }
    if (
      url.pathname.replace(/^\/api(?=\/)/, '') !==
      '/admin/sponsorships/media/upload'
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (!deps.canReview(request)) {
      deps.writeJson(request, response, 403, {
        code: 'MEDIA_UPLOAD_REVIEWER_REQUIRED'
      });
      return true;
    }
    if (request.method !== 'POST') {
      deps.writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    try {
      if (url.search)
        throw new SponsorMediaUploadError('INVALID_MEDIA_UPLOAD_REQUEST', 400);
      if (!deps.mediaUpload)
        throw new SponsorMediaUploadError(
          'SPONSOR_MEDIA_UPLOAD_UNAVAILABLE',
          503
        );
      const boundary = parseMultipartBoundary(request.headers['content-type']);
      if (!boundary)
        throw new SponsorMediaUploadError('MULTIPART_REQUIRED', 415);
      let parts: ReturnType<typeof parseMultipartFormData>;
      try {
        parts = parseMultipartFormData(
          await deps.readBodyBuffer(
            request,
            deps.sponsorMediaMaxBytes + SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES
          ),
          boundary
        );
      } catch {
        throw new SponsorMediaUploadError('SPONSOR_MEDIA_TOO_LARGE', 413);
      }
      if (
        parts.length !== 4 ||
        parts.some(
          (part) =>
            !['requestId', 'contributionId', 'kind', 'media'].includes(
              part.name
            )
        ) ||
        new Set(parts.map((part) => part.name)).size !== 4
      )
        throw new SponsorMediaUploadError('INVALID_MEDIA_UPLOAD_REQUEST', 400);
      const text = (name: string) =>
        parts
          .find((part) => part.name === name)!
          .data.toString('utf8')
          .trim();
      const file = parts.find((part) => part.name === 'media')!;
      if (
        !file.filename ||
        parts.some(
          (part) =>
            part.name !== 'media' &&
            (part.filename !== null || part.data.byteLength > 200)
        )
      )
        throw new SponsorMediaUploadError('INVALID_MEDIA_UPLOAD_REQUEST', 400);
      const result = await deps.mediaUpload.upload(
        {
          requestId: text('requestId'),
          contributionId: text('contributionId'),
          kind: text('kind') as 'logo' | 'supporting_image',
          filename: file.filename,
          contentType: file.contentType,
          bytes: file.data
        },
        deps.getAdminAuditActor(request)
      );
      deps.writeJson(request, response, 201, result);
    } catch (error) {
      deps.writeJson(
        request,
        response,
        error instanceof SponsorMediaUploadError ? error.status : 503,
        {
          code:
            error instanceof SponsorMediaUploadError
              ? error.code
              : 'SPONSOR_MEDIA_UPLOAD_UNAVAILABLE',
          ...(error instanceof SponsorMediaUploadError && error.assetId
            ? { assetId: error.assetId, uploaded: null }
            : {})
        }
      );
    }
    return true;
  };
}
