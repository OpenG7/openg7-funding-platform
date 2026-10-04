import { SPONSOR_LOGO_FILENAME_PATTERN } from '../sponsor-logo-upload.js';
import type {
  SponsorLogoStorage,
  SponsorMediaStorage
} from '../sponsor-media-storage.js';
import type { SponsorMediaStorageRecord } from '../sponsor-media.repository.js';
import { sponsorMediaPublicUrl } from '../sponsor-media/public-url.js';

import type { ReportWarning } from './contracts.js';
import { isValidUuid } from './request-validation.js';

const SPONSOR_LOGO_PUBLIC_PATH_PREFIX = '/api/public/sponsor-logos/';

export const sponsorLogoPublicUrlForFilename = (filename: string): string =>
  `${SPONSOR_LOGO_PUBLIC_PATH_PREFIX}${filename}`;

export const createMediaExposureHelpers = ({
  publicBaseOrigin,
  sponsorLogoStorage,
  sponsorMediaStorage,
  reportWarning
}: {
  readonly publicBaseOrigin: string;
  readonly sponsorLogoStorage: Pick<SponsorLogoStorage, 'deleteLogo'>;
  readonly sponsorMediaStorage: Pick<
    SponsorMediaStorage,
    'driver' | 'deletePrivateObject' | 'deletePublicObject'
  >;
  readonly reportWarning: ReportWarning;
}) => {
  const getSponsorLogoFilenameFromUrl = (
    url: string | undefined
  ): string | null => {
    if (!url) {
      return null;
    }

    try {
      const pathname = new URL(url, publicBaseOrigin).pathname;
      const allowedPrefixes = [
        SPONSOR_LOGO_PUBLIC_PATH_PREFIX,
        SPONSOR_LOGO_PUBLIC_PATH_PREFIX.replace('/api', '')
      ];
      const prefix = allowedPrefixes.find((candidate) =>
        pathname.startsWith(candidate)
      );

      if (!prefix) {
        return null;
      }

      return decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      return null;
    }
  };

  const deleteControlledSponsorLogoFile = async (
    logoUrl: string | null
  ): Promise<boolean> => {
    const filename = getSponsorLogoFilenameFromUrl(logoUrl ?? undefined);
    if (!filename) {
      return false;
    }

    if (!SPONSOR_LOGO_FILENAME_PATTERN.test(filename)) {
      return false;
    }

    try {
      return await sponsorLogoStorage.deleteLogo(filename);
    } catch (error) {
      reportWarning('Failed to delete controlled sponsor logo object.', error);
      return false;
    }
  };

  const routeAssetId = (
    url: string | undefined,
    ...prefixes: readonly string[]
  ): string | null => {
    if (!url) {
      return null;
    }
    try {
      const pathname = new URL(url, publicBaseOrigin).pathname;
      const prefix = prefixes.find((candidate) =>
        pathname.startsWith(candidate)
      );
      if (!prefix) {
        return null;
      }
      const assetId = decodeURIComponent(pathname.slice(prefix.length));
      return isValidUuid(assetId) ? assetId : null;
    } catch {
      return null;
    }
  };

  const deleteSponsorMediaObjects = async (
    asset: SponsorMediaStorageRecord,
    options: { readonly includePublic: boolean }
  ): Promise<void> => {
    const operations = [
      sponsorMediaStorage.deletePrivateObject(asset.originalStorageKey),
      sponsorMediaStorage.deletePrivateObject(asset.processedStorageKey)
    ];
    if (options.includePublic && asset.publicStorageKey) {
      operations.push(
        sponsorMediaStorage.deletePublicObject(asset.publicStorageKey)
      );
    }
    const results = await Promise.allSettled(operations);
    if (results.some((result) => result.status === 'rejected')) {
      reportWarning('One or more sponsor media objects could not be deleted.', {
        assetId: asset.id,
        storageDriver: sponsorMediaStorage.driver
      });
    }
  };

  return {
    getSponsorLogoFilenameFromUrl,
    deleteControlledSponsorLogoFile,
    sponsorMediaPublicUrl,
    routeAssetId,
    deleteSponsorMediaObjects
  };
};
