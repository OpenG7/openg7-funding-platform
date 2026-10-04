import type { SponsorMediaStorageDriver } from './storage-contracts.js';

export const SPONSOR_LOGO_S3_PREFIX = 'sponsor-logos/';

export const normalizeDriver = (
  driver: string | undefined
): SponsorMediaStorageDriver => {
  const normalized = (driver ?? 'local').trim().toLowerCase();
  if (normalized === 'local' || normalized === 'filesystem') {
    return 'local';
  }

  if (normalized === 'ovh-s3') {
    return 'ovh-s3';
  }

  throw new Error(
    'SPONSOR_MEDIA_STORAGE_DRIVER must be either local or ovh-s3.'
  );
};

export const required = (name: string, value: string | undefined): string => {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(
      `${name} is required when SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3.`
    );
  }

  return normalized;
};

export const assertNoTrailingSlash = (name: string, value: string): void => {
  if (value.endsWith('/')) {
    throw new Error(`${name} must not end with a slash.`);
  }
};

export const assertSafeFilename = (filename: string): void => {
  if (
    !filename ||
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    throw new Error(
      'Sponsor logo filename must be a single safe path segment.'
    );
  }
};

export const assertSafeObjectKey = (key: string): void => {
  const segments = key.split('/');
  if (
    !key ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.includes('\\') ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..'
    ) ||
    !/^[a-zA-Z0-9._/-]+$/.test(key)
  ) {
    throw new Error('Sponsor media key must be a safe relative object key.');
  }
};
