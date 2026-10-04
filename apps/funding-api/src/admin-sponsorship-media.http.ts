import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminSponsorMediaDeleteRequest,
  AdminSponsorMediaReviewRequest,
  AdminSponsorMediaReviewResult,
  AdminSponsorLogoDeleteRequest,
  AdminSponsorLogoDeleteResult,
  AdminSponsorLogoUploadResult,
  SponsorMediaAsset,
  SponsorMediaDeleteResult,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import type { AdminAuditLogInput } from './fund-admin.repository.js';
import type {
  SponsorshipLogoInput,
  SponsorshipLogoDeleteInput,
  SponsorshipLogoMutationResult,
  SponsorshipMutationStatus
} from './fund-contributions.repository.js';
import {
  parseMultipartBoundary,
  parseMultipartFormData,
  type MultipartPart
} from './http-multipart.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import {
  parseSponsorLogoUpload,
  SPONSOR_LOGO_FILENAME_PATTERN,
  contentTypeForSponsorLogoFilename
} from './sponsor-logo-upload.js';
import type {
  deleteSponsorMediaAsset as DeleteSponsorMediaAsset,
  reviewSponsorMediaAsset as ReviewSponsorMediaAsset,
  SponsorMediaMutationResult,
  SponsorMediaStorageRecord
} from './sponsor-media.repository.js';
import type {
  SponsorLogoStorage,
  SponsorMediaStorage
} from './sponsor-media-storage.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;
type LegacyPublicCopyCleanup =
  'not_required' | 'removed' | 'already_absent' | 'failed';

/** Bound admin media ports keep follow-up and public routes separate. */
export interface AdminSponsorshipMediaHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly sponsorMediaMaxBytes: number;
  readonly sponsorMediaMaxSupportingImages: number;
  readonly sponsorLogoMaxBytes: number;
  readonly SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH: number;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly readBodyBuffer: (
    request: ApiRequest,
    maxBytes: number
  ) => Promise<Buffer>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly writeBinary: ReturnType<typeof createHttpTransport>['writeBinary'];
  readonly isValidUuid: (value: unknown) => value is string;
  readonly isValidAdminExpectedVersion: (value: unknown) => value is string;
  readonly routeAssetId: (
    url: string | undefined,
    ...prefixes: readonly string[]
  ) => string | null;
  readonly listSponsorMediaAssets: (
    contributionId: string
  ) => Promise<readonly SponsorMediaAsset[]>;
  readonly getSponsorMediaStorageRecord: (
    assetId: string
  ) => Promise<SponsorMediaStorageRecord | null>;
  readonly reviewSponsorMediaAsset: (
    input: Parameters<typeof ReviewSponsorMediaAsset>[1]
  ) => Promise<SponsorMediaMutationResult>;
  readonly deleteSponsorMediaAsset: (
    input: Parameters<typeof DeleteSponsorMediaAsset>[1]
  ) => Promise<SponsorMediaMutationResult>;
  readonly sponsorMediaStorage: Pick<
    SponsorMediaStorage,
    'driver' | 'readPrivateObject' | 'deletePublicObject'
  >;
  readonly sponsorMediaPublicUrl: (assetId: string) => string;
  readonly deleteSponsorMediaObjects: (
    asset: SponsorMediaStorageRecord,
    options: { readonly includePublic: boolean }
  ) => Promise<void>;
  readonly writeSponsorMediaMutationFailure: (
    request: ApiRequest,
    response: ApiResponse,
    status: 'not_found' | 'conflict' | 'approved_locked' | 'not_editable'
  ) => void;
  readonly getAdminSponsorshipLogoUrl: (
    contributionId: string
  ) => Promise<string | null>;
  readonly clearSponsorshipLogoUrl: (
    input: SponsorshipLogoDeleteInput
  ) => Promise<SponsorshipLogoMutationResult>;
  readonly updateSponsorshipLogoUrl: (
    input: SponsorshipLogoInput
  ) => Promise<SponsorshipLogoMutationResult>;
  readonly sponsorLogoStorage: SponsorLogoStorage;
  readonly getSponsorLogoFilenameFromUrl: (
    url: string | undefined
  ) => string | null;
  readonly sponsorLogoPublicUrlForFilename: (filename: string) => string;
  readonly deleteControlledSponsorLogoFile: (
    logoUrl: string | null
  ) => Promise<boolean>;
  readonly writeSponsorshipMutationFailure: (
    request: ApiRequest,
    response: ApiResponse,
    status: SponsorshipMutationStatus,
    details?: {
      readonly currentVersion?: string | null;
      readonly paymentStatus?: string | null;
    }
  ) => void;
  readonly insertAdminAuditLog: (input: AdminAuditLogInput) => Promise<unknown>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Check API access before every owned preview or mutation. */
export const createAdminSponsorshipMediaHttpHandler = ({
  publicBaseOrigin,
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  sponsorLogoMaxBytes,
  SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  readBodyBuffer,
  writeJson,
  writeBinary,
  isValidUuid,
  isValidAdminExpectedVersion,
  routeAssetId,
  listSponsorMediaAssets,
  getSponsorMediaStorageRecord,
  reviewSponsorMediaAsset,
  deleteSponsorMediaAsset,
  sponsorMediaStorage,
  sponsorMediaPublicUrl,
  deleteSponsorMediaObjects,
  writeSponsorMediaMutationFailure,
  getAdminSponsorshipLogoUrl,
  clearSponsorshipLogoUrl,
  updateSponsorshipLogoUrl,
  sponsorLogoStorage,
  getSponsorLogoFilenameFromUrl,
  sponsorLogoPublicUrlForFilename,
  deleteControlledSponsorLogoFile,
  writeSponsorshipMutationFailure,
  insertAdminAuditLog,
  reportFailure
}: AdminSponsorshipMediaHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  const removeLegacyPublicCopy = async (
    asset: SponsorMediaStorageRecord
  ): Promise<LegacyPublicCopyCleanup> => {
    if (!asset.publicStorageKey) return 'not_required';
    try {
      return (await sponsorMediaStorage.deletePublicObject(
        asset.publicStorageKey
      ))
        ? 'removed'
        : 'already_absent';
    } catch {
      reportFailure('Legacy public sponsor media cleanup was incomplete.', {
        code: 'SPONSOR_MEDIA_PUBLIC_CLEANUP_INCOMPLETE'
      });
      return 'failed';
    }
  };

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/media',
        '/api/admin/sponsorships/media'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }
      const contributionId = new URL(
        request.url ?? '/',
        publicBaseOrigin
      ).searchParams.get('contributionId');
      if (!isValidUuid(contributionId)) {
        writeJson(request, response, 400, {
          error: 'Sponsor contribution id is invalid.'
        });
        return true;
      }
      try {
        const result: SponsorshipMediaResponse = {
          assets: await listSponsorMediaAssets(contributionId),
          limits: {
            maxUploadBytes: sponsorMediaMaxBytes,
            maxSupportingImages: sponsorMediaMaxSupportingImages,
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
          }
        };
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to list sponsor media for admin.', error);
        writeJson(request, response, 502, {
          error: 'Sponsor media could not be loaded. Apply migration 017.'
        });
      }
      return true;
    }

    const adminMediaContentId =
      request.method === 'GET'
        ? routeAssetId(
            request.url,
            '/admin/sponsorships/media/content/',
            '/api/admin/sponsorships/media/content/'
          )
        : null;
    if (adminMediaContentId) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }
      try {
        const asset = await getSponsorMediaStorageRecord(adminMediaContentId);
        const image = asset
          ? await sponsorMediaStorage.readPrivateObject(
              asset.processedStorageKey
            )
          : null;
        if (!asset || !image) {
          writeJson(request, response, 404, {
            error: 'Sponsor media was not found.'
          });
          return true;
        }
        writeBinary(request, response, 200, image, 'image/webp', {
          'Cache-Control': 'private, no-store'
        });
      } catch (error) {
        reportFailure('Failed to load admin sponsor media preview.', error);
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
        '/admin/sponsorships/media/review',
        '/api/admin/sponsorships/media/review'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }
      let parsed: AdminSponsorMediaReviewRequest;
      try {
        parsed = JSON.parse(
          await readBody(request, 32 * 1024)
        ) as AdminSponsorMediaReviewRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsor media review request.'
        });
        return true;
      }
      const altText = parsed.altText?.trim() || null;
      const reviewStatus =
        parsed.reviewStatus === 'approved' || parsed.reviewStatus === 'rejected'
          ? parsed.reviewStatus
          : null;
      if (
        !isValidUuid(parsed.assetId) ||
        !isValidAdminExpectedVersion(parsed.expectedVersion) ||
        !reviewStatus ||
        (altText?.length ?? 0) > SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH
      ) {
        writeJson(request, response, 400, {
          error: 'Asset id, version, and review decision are required.'
        });
        return true;
      }

      try {
        const current = await getSponsorMediaStorageRecord(parsed.assetId);
        if (!current) {
          writeJson(request, response, 404, {
            error: 'Sponsor media was not found.'
          });
          return true;
        }

        const reviewed = await reviewSponsorMediaAsset({
          assetId: current.id,
          expectedVersion: parsed.expectedVersion,
          reviewStatus,
          altText,
          // Retain legacy public keys for separately authorized storage remediation.
          publicStorageKey: current.publicStorageKey,
          publicUrl:
            reviewStatus === 'approved'
              ? sponsorMediaPublicUrl(current.id)
              : null,
          reviewedBy: getAdminAuditActor(request)
        });

        if (reviewed.status !== 'updated' || !reviewed.asset) {
          writeSponsorMediaMutationFailure(
            request,
            response,
            reviewed.status === 'conflict'
              ? 'conflict'
              : reviewed.status === 'approved_locked'
                ? 'approved_locked'
                : 'not_found'
          );
          return true;
        }

        const legacyPublicCopyCleanup =
          reviewStatus === 'rejected'
            ? await removeLegacyPublicCopy(reviewed.asset)
            : 'not_required';

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: `sponsorship.media.${reviewStatus}`,
          entityType: 'sponsor_media_asset',
          entityId: reviewed.asset.id,
          summary: `Sponsor media marked ${reviewStatus}.`,
          metadata: {
            contributionId: reviewed.asset.contributionId,
            kind: reviewed.asset.kind,
            storageDriver: sponsorMediaStorage.driver,
            ...(reviewStatus === 'rejected' ? { legacyPublicCopyCleanup } : {})
          }
        });
        const result: AdminSponsorMediaReviewResult = {
          updated: true,
          asset: reviewed.asset
        };
        if (legacyPublicCopyCleanup === 'failed') {
          writeJson(request, response, 502, {
            ...result,
            code: 'SPONSOR_MEDIA_PUBLIC_CLEANUP_INCOMPLETE',
            error:
              'The media review was saved, but the legacy public copy could not be removed.'
          });
        } else writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to review sponsor media.', error);
        writeJson(request, response, 502, {
          error: 'Sponsor media review could not be completed.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/media/delete',
        '/api/admin/sponsorships/media/delete'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }
      let parsed: AdminSponsorMediaDeleteRequest;
      try {
        parsed = JSON.parse(
          await readBody(request, 16 * 1024)
        ) as AdminSponsorMediaDeleteRequest;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsor media delete request.'
        });
        return true;
      }
      if (parsed.confirmation !== parsed.assetId) {
        writeJson(request, response, 400, {
          code: 'CONFIRMATION_REQUIRED',
          error: 'Confirm the selected media before deleting it.'
        });
        return true;
      }
      if (
        !isValidUuid(parsed.assetId) ||
        !isValidAdminExpectedVersion(parsed.expectedVersion)
      ) {
        writeJson(request, response, 400, {
          error: 'Sponsor media id and version are required.'
        });
        return true;
      }
      try {
        const current = await getSponsorMediaStorageRecord(parsed.assetId);
        if (!current) {
          writeJson(request, response, 404, {
            error: 'Sponsor media was not found.'
          });
          return true;
        }
        const deleted = await deleteSponsorMediaAsset({
          assetId: parsed.assetId,
          expectedVersion: parsed.expectedVersion,
          allowApproved: true
        });
        if (deleted.status !== 'updated' || !deleted.asset) {
          writeSponsorMediaMutationFailure(
            request,
            response,
            deleted.status === 'conflict'
              ? 'conflict'
              : deleted.status === 'approved_locked'
                ? 'approved_locked'
                : 'not_found'
          );
          return true;
        }
        const legacyPublicCopyCleanup = await removeLegacyPublicCopy(
          deleted.asset
        );
        await deleteSponsorMediaObjects(deleted.asset, {
          includePublic: false
        });
        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'sponsorship.media.delete',
          entityType: 'sponsor_media_asset',
          entityId: deleted.asset.id,
          summary: 'Sponsor media deleted by an administrator.',
          metadata: {
            contributionId: deleted.asset.contributionId,
            kind: deleted.asset.kind,
            storageDriver: sponsorMediaStorage.driver,
            legacyPublicCopyCleanup
          }
        });
        const result: SponsorMediaDeleteResult = {
          deleted: true,
          assetId: deleted.asset.id
        };
        if (legacyPublicCopyCleanup === 'failed') {
          writeJson(request, response, 502, {
            ...result,
            code: 'SPONSOR_MEDIA_PUBLIC_CLEANUP_INCOMPLETE',
            error:
              'The media was deleted, but the legacy public copy could not be removed.'
          });
        } else writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to delete sponsor media for admin.', error);
        writeJson(request, response, 502, {
          error: 'Sponsor media could not be deleted.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/logo',
        '/api/admin/sponsorships/logo'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      const contributionId = new URL(
        request.url ?? '/',
        publicBaseOrigin
      ).searchParams.get('contributionId');

      if (!isValidUuid(contributionId)) {
        writeJson(request, response, 400, {
          error: 'Sponsor contribution id is invalid.'
        });
        return true;
      }

      try {
        const logoUrl = await getAdminSponsorshipLogoUrl(contributionId);
        const filename = getSponsorLogoFilenameFromUrl(logoUrl ?? undefined);

        if (!filename) {
          writeJson(request, response, 404, {
            error: 'Sponsor logo was not found.'
          });
          return true;
        }

        const contentType = contentTypeForSponsorLogoFilename(filename);

        if (!SPONSOR_LOGO_FILENAME_PATTERN.test(filename) || !contentType) {
          writeJson(request, response, 404, {
            error: 'Sponsor logo was not found.'
          });
          return true;
        }

        const logo = await sponsorLogoStorage.readLogo(filename);
        if (!logo) {
          writeJson(request, response, 404, {
            error: 'Sponsor logo was not found.'
          });
          return true;
        }

        writeBinary(request, response, 200, logo, contentType, {
          'Cache-Control': 'private, no-store'
        });
      } catch (error) {
        reportFailure('Failed to load admin sponsor logo preview.', error);
        writeJson(request, response, 404, {
          error: 'Sponsor logo was not found.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/logo/delete',
        '/api/admin/sponsorships/logo/delete'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      let parsed: Partial<AdminSponsorLogoDeleteRequest> | null;
      try {
        const body = await readBody(request, 16 * 1024);
        parsed = JSON.parse(
          body
        ) as Partial<AdminSponsorLogoDeleteRequest> | null;
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsor logo delete request body.'
        });
        return true;
      }

      const contributionId = parsed?.contributionId;
      const expectedVersion = parsed?.expectedVersion;

      if (!isValidUuid(contributionId)) {
        writeJson(request, response, 400, {
          error: 'Sponsor contribution id is invalid.'
        });
        return true;
      }

      if (!isValidAdminExpectedVersion(expectedVersion)) {
        writeJson(request, response, 400, {
          error: 'Sponsor version is required.'
        });
        return true;
      }

      try {
        const deleteResult = await clearSponsorshipLogoUrl({
          contributionId,
          expectedVersion
        });

        if (!deleteResult.updated) {
          writeSponsorshipMutationFailure(
            request,
            response,
            deleteResult.status,
            {
              currentVersion: deleteResult.currentVersion
            }
          );
          return true;
        }

        const deletedMediaObject = await deleteControlledSponsorLogoFile(
          deleteResult.previousLogoUrl
        );

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'sponsorship.logo.delete',
          entityType: 'sponsorship',
          entityId: contributionId,
          summary: 'Sponsor logo removed from controlled public display.',
          metadata: {
            deletedLogoUrl: deleteResult.previousLogoUrl,
            deletedMediaObject,
            storageDriver: sponsorLogoStorage.driver
          }
        });

        const result: AdminSponsorLogoDeleteResult = {
          updated: deleteResult.updated,
          contributionId,
          deletedLogoUrl: deleteResult.previousLogoUrl
        };
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to delete sponsor logo.', error);
        writeJson(request, response, 502, {
          error: 'Sponsor logo could not be deleted.'
        });
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/logo',
        '/api/admin/sponsorships/logo'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      const boundary = parseMultipartBoundary(request.headers['content-type']);
      if (!boundary) {
        writeJson(request, response, 400, {
          error: 'Sponsor logo upload must use multipart/form-data.'
        });
        return true;
      }

      let parts: readonly MultipartPart[];
      try {
        const body = await readBodyBuffer(
          request,
          sponsorLogoMaxBytes + 64 * 1024
        );
        parts = parseMultipartFormData(body, boundary);
      } catch {
        writeJson(request, response, 413, {
          error: 'Sponsor logo upload is too large.'
        });
        return true;
      }

      const contributionId =
        parts
          .find((part) => part.name === 'contributionId')
          ?.data.toString('utf8')
          .trim() ?? '';
      const expectedVersion =
        parts
          .find((part) => part.name === 'expectedVersion')
          ?.data.toString('utf8')
          .trim() ?? '';

      if (!isValidUuid(contributionId)) {
        writeJson(request, response, 400, {
          error: 'Sponsor contribution id is invalid.'
        });
        return true;
      }

      if (!isValidAdminExpectedVersion(expectedVersion)) {
        writeJson(request, response, 400, {
          error: 'Sponsor version is required.'
        });
        return true;
      }

      const logo = parseSponsorLogoUpload(
        parts,
        contributionId,
        sponsorLogoMaxBytes
      );
      if (!logo) {
        writeJson(request, response, 400, {
          error: 'Sponsor logo must be a valid PNG, JPEG, or WebP image.'
        });
        return true;
      }

      if (!SPONSOR_LOGO_FILENAME_PATTERN.test(logo.filename)) {
        writeJson(request, response, 400, {
          error: 'Sponsor logo filename is invalid.'
        });
        return true;
      }

      const logoUrl = sponsorLogoPublicUrlForFilename(logo.filename);

      try {
        await sponsorLogoStorage.writeLogo({
          filename: logo.filename,
          data: logo.data,
          contentType: logo.mimeType
        });

        const updateResult = await updateSponsorshipLogoUrl({
          contributionId,
          logoUrl,
          expectedVersion
        });

        if (!updateResult.updated) {
          await sponsorLogoStorage
            .deleteLogo(logo.filename)
            .catch(() => undefined);
          writeSponsorshipMutationFailure(
            request,
            response,
            updateResult.status,
            {
              currentVersion: updateResult.currentVersion
            }
          );
          return true;
        }

        const replacedMediaObject = await deleteControlledSponsorLogoFile(
          updateResult.previousLogoUrl
        );

        await insertAdminAuditLog({
          actor: getAdminAuditActor(request),
          action: 'sponsorship.logo.upload',
          entityType: 'sponsorship',
          entityId: contributionId,
          summary: 'Sponsor logo uploaded for controlled public display.',
          metadata: {
            logoUrl,
            previousLogoUrl: updateResult.previousLogoUrl,
            replacedMediaObject,
            storageDriver: sponsorLogoStorage.driver,
            mimeType: logo.mimeType,
            sizeBytes: logo.sizeBytes
          }
        });

        const result: AdminSponsorLogoUploadResult = {
          updated: updateResult.updated,
          contributionId,
          logoUrl,
          mimeType: logo.mimeType,
          sizeBytes: logo.sizeBytes
        };
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to upload sponsor logo.', error);
        writeJson(request, response, 502, {
          error: 'Sponsor logo could not be uploaded.'
        });
      }
      return true;
    }
    return false;
  };
};
