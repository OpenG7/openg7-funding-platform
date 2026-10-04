import type {
  SponsorLogoStorage,
  SponsorLogoStorageConfig,
  SponsorMediaStorage
} from './sponsor-media/storage-contracts.js';
import {
  LocalSponsorLogoStorage,
  LocalSponsorMediaStorage
} from './sponsor-media/local-storage.js';
import {
  OvhS3SponsorLogoStorage,
  OvhS3SponsorMediaStorage
} from './sponsor-media/s3-storage.js';
import { normalizeDriver } from './sponsor-media/storage-policy.js';

export type {
  SponsorMediaStorageDriver,
  SponsorLogoStorage,
  SponsorLogoWriteInput,
  SponsorLogoStorageConfig,
  SponsorLogoS3StorageConfig,
  SponsorMediaStorage,
  SponsorMediaWriteInput,
  SponsorMediaPublishInput
} from './sponsor-media/storage-contracts.js';

export const createSponsorLogoStorage = (
  config: SponsorLogoStorageConfig
): SponsorLogoStorage => {
  const driver = normalizeDriver(config.driver);

  if (driver === 'ovh-s3') {
    return new OvhS3SponsorLogoStorage(config.s3);
  }

  return new LocalSponsorLogoStorage(config.localStorageDir);
};

export const createSponsorMediaStorage = (
  config: SponsorLogoStorageConfig
): SponsorMediaStorage => {
  const driver = normalizeDriver(config.driver);
  return driver === 'ovh-s3'
    ? new OvhS3SponsorMediaStorage(config.s3)
    : new LocalSponsorMediaStorage(config.localStorageDir);
};
