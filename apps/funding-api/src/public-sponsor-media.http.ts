import type { IncomingMessage, ServerResponse } from 'node:http';

import type { createHttpTransport } from './http-transport.js';
import {
  contentTypeForSponsorLogoFilename,
  SPONSOR_LOGO_FILENAME_PATTERN
} from './sponsor-logo-upload.js';
import type { SponsorMediaStorageRecord } from './sponsor-media.repository.js';
import type {
  SponsorLogoStorage,
  SponsorMediaStorage
} from './sponsor-media-storage.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Public media approval and storage reads are supplied without private database or SDK state. */
export interface PublicSponsorMediaHttpDependencies {
  readonly databaseAvailable: () => boolean;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly writeBinary: ReturnType<typeof createHttpTransport>['writeBinary'];
  readonly routeAssetId: (
    url: string | undefined,
    ...prefixes: readonly string[]
  ) => string | null;
  readonly getApprovedPublicSponsorMedia: (
    assetId: string
  ) => Promise<SponsorMediaStorageRecord | null>;
  readonly sponsorMediaStorage: Pick<SponsorMediaStorage, 'readPrivateObject'>;
  readonly getSponsorLogoFilenameFromUrl: (
    url: string | undefined
  ) => string | null;
  readonly sponsorLogoPublicUrlForFilename: (filename: string) => string;
  readonly isPublicApprovedSponsorshipLogoUrl: (
    publicLogoUrl: string
  ) => Promise<boolean>;
  readonly sponsorLogoStorage: Pick<SponsorLogoStorage, 'readLogo'>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Serve approved public objects with each existing route's cache policy. */
export const createPublicSponsorMediaHttpHandler = ({
  databaseAvailable,
  writeJson,
  writeBinary,
  routeAssetId,
  getApprovedPublicSponsorMedia,
  sponsorMediaStorage,
  getSponsorLogoFilenameFromUrl,
  sponsorLogoPublicUrlForFilename,
  isPublicApprovedSponsorshipLogoUrl,
  sponsorLogoStorage,
  reportFailure
}: PublicSponsorMediaHttpDependencies) => {
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    const publicSponsorMediaId =
      request.method === 'GET'
        ? routeAssetId(
            request.url,
            '/public/sponsor-media/',
            '/api/public/sponsor-media/'
          )
        : null;
    if (publicSponsorMediaId) {
      try {
        const asset = await getApprovedPublicSponsorMedia(publicSponsorMediaId);
        const image = asset
          ? await sponsorMediaStorage.readPrivateObject(
              asset.processedStorageKey
            )
          : null;
        if (!asset || !image) {
          writeJson(request, response, 404, { error: 'Not found' });
          return true;
        }
        writeBinary(request, response, 200, image, 'image/webp', {
          'Cache-Control': 'no-store'
        });
      } catch (error) {
        reportFailure('Failed to serve public sponsor media.', error);
        writeJson(request, response, 404, { error: 'Not found' });
      }
      return true;
    }

    if (request.method === 'GET') {
      const filename = getSponsorLogoFilenameFromUrl(request.url);
      if (filename) {
        if (!databaseAvailable()) {
          writeJson(request, response, 404, { error: 'Not found' });
          return true;
        }

        const contentType = contentTypeForSponsorLogoFilename(filename);
        const publicLogoUrl = sponsorLogoPublicUrlForFilename(filename);

        if (!SPONSOR_LOGO_FILENAME_PATTERN.test(filename) || !contentType) {
          writeJson(request, response, 404, { error: 'Not found' });
          return true;
        }

        try {
          const isAllowed =
            await isPublicApprovedSponsorshipLogoUrl(publicLogoUrl);

          if (!isAllowed) {
            writeJson(request, response, 404, { error: 'Not found' });
            return true;
          }

          const logo = await sponsorLogoStorage.readLogo(filename);
          if (!logo) {
            writeJson(request, response, 404, { error: 'Not found' });
            return true;
          }

          writeBinary(request, response, 200, logo, contentType, {
            'Cache-Control': 'public, max-age=86400'
          });
        } catch (error) {
          reportFailure('Failed to serve sponsor logo.', error);
          writeJson(request, response, 404, { error: 'Not found' });
        }
        return true;
      }
    }

    return false;
  };
};
