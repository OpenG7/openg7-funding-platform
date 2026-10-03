import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  SponsorMediaAsset,
  SponsorMediaDeleteRequest,
  SponsorMediaDeleteResult,
  SponsorMediaKind,
  SponsorMediaUploadResult,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { isSafeSponsorshipText } from '../../../packages/funding-core/src/index.js';

import type { AdminAuditLogInput } from './fund-admin.repository.js';
import type { SponsorshipFollowupLookup } from './fund-contributions.repository.js';
import {
  parseMultipartBoundary,
  parseMultipartFormData,
  type MultipartPart
} from './http-multipart.js';
import { createRouteMatcher, firstHeaderValue } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import type {
  ProcessSponsorImageInput,
  ProcessedSponsorImage
} from './sponsor-image.service.js';
import { SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES } from './sponsor-media-limits.js';
import type {
  checkSponsorMediaUpload as CheckSponsorMediaUpload,
  CreateSponsorMediaAssetInput,
  CreateSponsorMediaAssetResult,
  deleteSponsorMediaAsset as DeleteSponsorMediaAsset,
  SponsorMediaMutationResult,
  SponsorMediaStorageRecord
} from './sponsor-media.repository.js';
import type { SponsorMediaStorage } from './sponsor-media-storage.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

const allowedSponsorMediaKinds = new Set<SponsorMediaKind>([
  'logo',
  'supporting_image'
]);

const parseSponsorMediaKind = (value: string): SponsorMediaKind | null =>
  allowedSponsorMediaKinds.has(value as SponsorMediaKind)
    ? (value as SponsorMediaKind)
    : null;

const sponsorMediaPrivateBaseKey = (
  contributionId: string,
  assetId: string
): string => `sponsors/${contributionId}/${assetId}`;

/** Follow-up media ports retain payment refresh, persistence and storage in composition. */
export interface SponsorshipFollowupMediaHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly databaseAvailable: () => boolean;
  readonly sponsorMediaMaxBytes: number;
  readonly sponsorMediaMaxSupportingImages: number;
  readonly SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH: number;
  readonly followupEditablePaymentStatuses: ReadonlySet<string>;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly readBodyBuffer: (
    request: ApiRequest,
    maxBytes: number
  ) => Promise<Buffer>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly writeBinary: ReturnType<typeof createHttpTransport>['writeBinary'];
  readonly isValidFollowupToken: (value: unknown) => value is string;
  readonly isValidUuid: (value: unknown) => value is string;
  readonly isValidAdminExpectedVersion: (value: unknown) => value is string;
  readonly hasOnlyKeys: (value: unknown, keys: readonly string[]) => boolean;
  readonly routeAssetId: (
    url: string | undefined,
    ...prefixes: readonly string[]
  ) => string | null;
  readonly getFreshSponsorshipFollowupByToken: (
    token: string
  ) => Promise<SponsorshipFollowupLookup | null>;
  readonly listSponsorMediaAssets: (
    contributionId: string
  ) => Promise<readonly SponsorMediaAsset[]>;
  readonly getSponsorMediaStorageRecord: (
    assetId: string
  ) => Promise<SponsorMediaStorageRecord | null>;
  readonly checkSponsorMediaUpload: (
    contributionId: string,
    kind: SponsorMediaKind,
    maxSupportingImages: number
  ) => ReturnType<typeof CheckSponsorMediaUpload>;
  readonly createSponsorMediaAsset: (
    input: CreateSponsorMediaAssetInput
  ) => Promise<CreateSponsorMediaAssetResult>;
  readonly deleteSponsorMediaAsset: (
    input: Parameters<typeof DeleteSponsorMediaAsset>[1]
  ) => Promise<SponsorMediaMutationResult>;
  readonly processSponsorImage: (
    input: ProcessSponsorImageInput
  ) => Promise<ProcessedSponsorImage>;
  readonly sponsorMediaStorage: Pick<
    SponsorMediaStorage,
    | 'driver'
    | 'readPrivateObject'
    | 'writePrivateObject'
    | 'deletePrivateObject'
  >;
  readonly deleteSponsorMediaObjects: (
    asset: SponsorMediaStorageRecord,
    options: { readonly includePublic: boolean }
  ) => Promise<void>;
  readonly writeSponsorMediaMutationFailure: (
    request: ApiRequest,
    response: ApiResponse,
    status: 'not_found' | 'conflict' | 'approved_locked' | 'not_editable'
  ) => void;
  readonly insertAdminAuditLog: (input: AdminAuditLogInput) => Promise<unknown>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Own private follow-up media; JSON preflight and rate limits remain at the server boundary. */
export const createSponsorshipFollowupMediaHttpHandler = ({
  publicBaseOrigin,
  databaseAvailable,
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH,
  followupEditablePaymentStatuses,
  readBody,
  readBodyBuffer,
  writeJson,
  writeBinary,
  isValidFollowupToken,
  isValidUuid,
  isValidAdminExpectedVersion,
  hasOnlyKeys,
  routeAssetId,
  getFreshSponsorshipFollowupByToken,
  listSponsorMediaAssets,
  getSponsorMediaStorageRecord,
  checkSponsorMediaUpload,
  createSponsorMediaAsset,
  deleteSponsorMediaAsset,
  processSponsorImage,
  sponsorMediaStorage,
  deleteSponsorMediaObjects,
  writeSponsorMediaMutationFailure,
  insertAdminAuditLog,
  reportFailure
}: SponsorshipFollowupMediaHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/sponsorship-followup/media',
        '/api/sponsorship-followup/media'
      )
    ) {
      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Sponsorship media requires DATABASE_URL.'
        });
        return true;
      }
      const token = new URL(
        request.url ?? '/',
        publicBaseOrigin
      ).searchParams.get('token');
      if (!isValidFollowupToken(token)) {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship follow-up token.'
        });
        return true;
      }
      try {
        const followup = await getFreshSponsorshipFollowupByToken(token);
        if (!followup) {
          writeJson(request, response, 404, {
            error: 'Sponsorship follow-up was not found.'
          });
          return true;
        }
        const result: SponsorshipMediaResponse = {
          assets: await listSponsorMediaAssets(followup.contributionId),
          limits: {
            maxUploadBytes: sponsorMediaMaxBytes,
            maxSupportingImages: sponsorMediaMaxSupportingImages,
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
          }
        };
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load sponsorship media.', error);
        writeJson(request, response, 502, {
          error: 'Sponsorship media could not be loaded. Apply migration 017.'
        });
      }
      return true;
    }

    const sponsorMediaContentId =
      request.method === 'GET'
        ? routeAssetId(
            request.url,
            '/sponsorship-followup/media/content/',
            '/api/sponsorship-followup/media/content/'
          )
        : null;
    if (sponsorMediaContentId) {
      const token = firstHeaderValue(
        request.headers['x-sponsorship-followup-token']
      );
      if (!isValidFollowupToken(token)) {
        writeJson(request, response, 401, {
          error: 'Sponsorship follow-up token is required.'
        });
        return true;
      }
      try {
        const [followup, asset] = await Promise.all([
          getFreshSponsorshipFollowupByToken(token),
          getSponsorMediaStorageRecord(sponsorMediaContentId)
        ]);
        if (
          !followup ||
          !asset ||
          asset.contributionId !== followup.contributionId
        ) {
          writeJson(request, response, 404, {
            error: 'Sponsor media was not found.'
          });
          return true;
        }
        const image = await sponsorMediaStorage.readPrivateObject(
          asset.processedStorageKey
        );
        if (!image) {
          writeJson(request, response, 404, {
            error: 'Sponsor media was not found.'
          });
          return true;
        }
        writeBinary(request, response, 200, image, 'image/webp', {
          'Cache-Control': 'private, no-store'
        });
      } catch (error) {
        reportFailure('Failed to load sponsorship media preview.', error);
        writeJson(request, response, 404, {
          error: 'Sponsor media was not found.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/sponsorship-followup/media',
        '/api/sponsorship-followup/media'
      )
    ) {
      if (!databaseAvailable()) {
        writeJson(request, response, 503, {
          error: 'Sponsorship media requires DATABASE_URL.'
        });
        return true;
      }
      const boundary = parseMultipartBoundary(request.headers['content-type']);
      if (!boundary) {
        writeJson(request, response, 400, {
          error: 'Sponsor media upload must use multipart/form-data.'
        });
        return true;
      }
      let parts: readonly MultipartPart[];
      try {
        parts = parseMultipartFormData(
          await readBodyBuffer(
            request,
            sponsorMediaMaxBytes + SPONSOR_MEDIA_MULTIPART_OVERHEAD_BYTES
          ),
          boundary
        );
      } catch {
        writeJson(request, response, 413, {
          code: 'SPONSOR_MEDIA_TOO_LARGE',
          error: 'Sponsor media upload is too large.'
        });
        return true;
      }
      const textPart = (name: string): string =>
        parts
          .find((part) => part.name === name)
          ?.data.toString('utf8')
          .trim() ?? '';
      const token = textPart('token');
      const kind = parseSponsorMediaKind(textPart('kind'));
      const altText = textPart('altText') || null;
      const file = parts.find((part) => part.name === 'media');
      if (file && file.data.byteLength > sponsorMediaMaxBytes) {
        writeJson(request, response, 413, {
          code: 'SPONSOR_MEDIA_TOO_LARGE',
          error: 'Sponsor media upload is too large.'
        });
        return true;
      }
      if (
        parts.some(
          (part) => !['token', 'kind', 'altText', 'media'].includes(part.name)
        ) ||
        new Set(parts.map((part) => part.name)).size !== parts.length ||
        !isValidFollowupToken(token) ||
        !kind ||
        !file?.filename ||
        file.data.byteLength === 0 ||
        (altText !== null && !isSafeSponsorshipText(altText)) ||
        (altText?.length ?? 0) > SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH
      ) {
        writeJson(request, response, 400, {
          error: 'A valid token, media kind, and image file are required.'
        });
        return true;
      }

      let originalStorageKey: string | null = null;
      let processedStorageKey: string | null = null;
      try {
        const followup = await getFreshSponsorshipFollowupByToken(token);
        if (!followup) {
          writeJson(request, response, 404, {
            error: 'Sponsorship follow-up was not found.'
          });
          return true;
        }
        if (!followupEditablePaymentStatuses.has(followup.paymentStatus)) {
          writeJson(request, response, 409, {
            error: 'Payment for this sponsorship is not confirmed yet.'
          });
          return true;
        }

        const eligibility = await checkSponsorMediaUpload(
          followup.contributionId,
          kind,
          sponsorMediaMaxSupportingImages
        );
        if (eligibility !== 'allowed') {
          const error =
            eligibility === 'supporting_image_limit_reached'
              ? 'The supporting image limit has been reached.'
              : eligibility === 'logo_locked'
                ? 'The approved logo must be replaced by an administrator.'
                : eligibility === 'not_editable'
                  ? 'Sponsorship is not editable.'
                  : 'Sponsorship follow-up was not found.';
          writeJson(
            request,
            response,
            eligibility === 'contribution_not_found' ? 404 : 409,
            { code: eligibility, error }
          );
          return true;
        }

        const image = await processSponsorImage({
          data: file.data,
          kind,
          originalFilename: file.filename
        });
        if (file.contentType && file.contentType !== image.originalMimeType) {
          writeJson(request, response, 400, {
            error: 'The declared image type does not match its contents.'
          });
          return true;
        }
        const assetId = randomUUID();
        const baseKey = sponsorMediaPrivateBaseKey(
          followup.contributionId,
          assetId
        );
        originalStorageKey = `${baseKey}/original.${image.originalExtension}`;
        processedStorageKey = `${baseKey}/processed.webp`;
        await sponsorMediaStorage.writePrivateObject({
          key: originalStorageKey,
          data: image.originalData,
          contentType: image.originalMimeType
        });
        await sponsorMediaStorage.writePrivateObject({
          key: processedStorageKey,
          data: image.processedData,
          contentType: image.processedMimeType
        });

        const created = await createSponsorMediaAsset({
          id: assetId,
          contributionId: followup.contributionId,
          kind,
          uploadedBy: 'sponsor',
          originalFilename: image.originalFilename,
          originalMimeType: image.originalMimeType,
          originalSizeBytes: image.originalSizeBytes,
          originalStorageKey,
          processedSizeBytes: image.processedSizeBytes,
          processedStorageKey,
          checksumSha256: image.checksumSha256,
          width: image.width,
          height: image.height,
          altText,
          maxSupportingImages: sponsorMediaMaxSupportingImages
        });
        if (created.status !== 'created') {
          await Promise.allSettled([
            sponsorMediaStorage.deletePrivateObject(originalStorageKey),
            sponsorMediaStorage.deletePrivateObject(processedStorageKey)
          ]);
          const statusCode =
            created.status === 'contribution_not_found' ? 404 : 409;
          const error =
            created.status === 'logo_locked'
              ? 'The approved logo must be replaced by an administrator.'
              : created.status === 'supporting_image_limit_reached'
                ? 'The supporting image limit has been reached.'
                : created.status === 'not_editable'
                  ? 'Sponsorship is not editable.'
                  : 'Sponsorship follow-up was not found.';
          writeJson(request, response, statusCode, {
            code: created.status,
            error
          });
          return true;
        }
        if (created.replaced) {
          await deleteSponsorMediaObjects(created.replaced, {
            includePublic: false
          });
        }
        await insertAdminAuditLog({
          actor: 'sponsor-followup',
          action: 'sponsorship.media.upload',
          entityType: 'sponsor_media_asset',
          entityId: created.asset.id,
          summary: 'Sponsor media uploaded through the private follow-up flow.',
          metadata: {
            contributionId: created.asset.contributionId,
            kind: created.asset.kind,
            mimeType: created.asset.originalMimeType,
            sizeBytes: created.asset.originalSizeBytes,
            storageDriver: sponsorMediaStorage.driver
          }
        });
        const result: SponsorMediaUploadResult = {
          uploaded: true,
          asset: created.asset
        };
        writeJson(request, response, 201, result);
      } catch (error) {
        if (originalStorageKey) {
          await sponsorMediaStorage
            .deletePrivateObject(originalStorageKey)
            .catch(() => undefined);
        }
        if (processedStorageKey) {
          await sponsorMediaStorage
            .deletePrivateObject(processedStorageKey)
            .catch(() => undefined);
        }
        reportFailure('Failed to upload sponsorship media.', error);
        writeJson(request, response, 400, {
          error: 'Sponsor media must be a valid JPEG, PNG, or WebP image.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/sponsorship-followup/media/delete',
        '/api/sponsorship-followup/media/delete'
      )
    ) {
      let parsed: SponsorMediaDeleteRequest;
      try {
        parsed = JSON.parse(
          await readBody(request, 16 * 1024)
        ) as SponsorMediaDeleteRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsor media delete request.'
        });
        return true;
      }
      if (
        !hasOnlyKeys(parsed, [
          'token',
          'assetId',
          'expectedVersion',
          'confirmed'
        ]) ||
        parsed.confirmed !== true ||
        !isValidFollowupToken(parsed.token) ||
        !isValidUuid(parsed.assetId) ||
        !isValidAdminExpectedVersion(parsed.expectedVersion)
      ) {
        writeJson(request, response, 400, {
          error: 'A valid token, media id, and version are required.'
        });
        return true;
      }
      try {
        const followup = await getFreshSponsorshipFollowupByToken(parsed.token);
        if (!followup) {
          writeJson(request, response, 404, {
            error: 'Sponsorship follow-up was not found.'
          });
          return true;
        }
        const deleted = await deleteSponsorMediaAsset({
          assetId: parsed.assetId,
          contributionId: followup.contributionId,
          expectedVersion: parsed.expectedVersion,
          allowApproved: false
        });
        if (deleted.status !== 'updated' || !deleted.asset) {
          writeSponsorMediaMutationFailure(
            request,
            response,
            deleted.status === 'conflict'
              ? 'conflict'
              : deleted.status === 'not_editable'
                ? 'not_editable'
                : deleted.status === 'approved_locked'
                  ? 'approved_locked'
                  : 'not_found'
          );
          return true;
        }
        await deleteSponsorMediaObjects(deleted.asset, {
          includePublic: false
        });
        await insertAdminAuditLog({
          actor: 'sponsor-followup',
          action: 'sponsorship.media.delete',
          entityType: 'sponsor_media_asset',
          entityId: deleted.asset.id,
          summary: 'Pending sponsor media deleted through the follow-up flow.',
          metadata: {
            contributionId: deleted.asset.contributionId,
            kind: deleted.asset.kind
          }
        });
        const result: SponsorMediaDeleteResult = {
          deleted: true,
          assetId: deleted.asset.id
        };
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to delete sponsorship media.', error);
        writeJson(request, response, 502, {
          error: 'Sponsor media could not be deleted.'
        });
      }
      return true;
    }

    return false;
  };
};
