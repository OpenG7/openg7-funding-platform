import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

export type SponsorMediaStorageDriver = 'local' | 'ovh-s3';

export interface SponsorLogoStorage {
  readonly driver: SponsorMediaStorageDriver;
  readLogo(filename: string): Promise<Buffer | null>;
  writeLogo(input: SponsorLogoWriteInput): Promise<void>;
  deleteLogo(filename: string): Promise<boolean>;
}

export interface SponsorLogoWriteInput {
  readonly filename: string;
  readonly data: Buffer;
  readonly contentType: string;
}

export interface SponsorLogoStorageConfig {
  readonly driver: string | undefined;
  readonly localStorageDir: string;
  readonly s3: SponsorLogoS3StorageConfig;
}

export interface SponsorLogoS3StorageConfig {
  readonly region: string | undefined;
  readonly endpoint: string | undefined;
  readonly privateBucket: string | undefined;
  readonly publicBucket: string | undefined;
  readonly publicBaseUrl: string | undefined;
  readonly privateBaseUrl: string | undefined;
  readonly accessKeyId: string | undefined;
  readonly secretAccessKey: string | undefined;
}

const SPONSOR_LOGO_S3_PREFIX = 'sponsor-logos/';

const normalizeDriver = (
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

const required = (name: string, value: string | undefined): string => {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(
      `${name} is required when SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3.`
    );
  }

  return normalized;
};

const assertNoTrailingSlash = (name: string, value: string): void => {
  if (value.endsWith('/')) {
    throw new Error(`${name} must not end with a slash.`);
  }
};

const assertSafeFilename = (filename: string): void => {
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

const isS3NotFoundError = (error: unknown): boolean => {
  const candidate = error as {
    readonly name?: string;
    readonly $metadata?: { readonly httpStatusCode?: number };
  };

  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound'
  );
};

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

const responseBodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  const transformable = body as {
    readonly transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof transformable.transformToByteArray === 'function') {
    return Buffer.from(await transformable.transformToByteArray());
  }

  if (body instanceof Readable) {
    return streamToBuffer(body);
  }

  throw new Error('Unsupported S3 response body type.');
};

class LocalSponsorLogoStorage implements SponsorLogoStorage {
  readonly driver = 'local' as const;

  constructor(private readonly storageDir: string) {}

  async readLogo(filename: string): Promise<Buffer | null> {
    const filePath = this.resolveFilePath(filename);

    try {
      return await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async writeLogo(input: SponsorLogoWriteInput): Promise<void> {
    const filePath = this.resolveFilePath(input.filename);
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(filePath, input.data, { flag: 'wx' });
  }

  async deleteLogo(filename: string): Promise<boolean> {
    const filePath = this.resolveFilePath(filename);

    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }

      throw error;
    }
  }

  private resolveFilePath(filename: string): string {
    assertSafeFilename(filename);

    const resolvedFilePath = path.resolve(this.storageDir, filename);
    if (!resolvedFilePath.startsWith(`${this.storageDir}${path.sep}`)) {
      throw new Error(
        'Sponsor logo filename resolved outside the storage directory.'
      );
    }

    return resolvedFilePath;
  }
}

class OvhS3SponsorLogoStorage implements SponsorLogoStorage {
  readonly driver = 'ovh-s3' as const;

  private readonly client: S3Client;
  private readonly privateBucket: string;

  constructor(config: SponsorLogoS3StorageConfig) {
    const region = required('SPONSOR_MEDIA_REGION', config.region);
    const endpoint = required('SPONSOR_MEDIA_ENDPOINT', config.endpoint);
    const privateBucket = required(
      'SPONSOR_MEDIA_PRIVATE_BUCKET',
      config.privateBucket
    );
    required('SPONSOR_MEDIA_PUBLIC_BUCKET', config.publicBucket);
    const publicBaseUrl = required(
      'SPONSOR_MEDIA_PUBLIC_BASE_URL',
      config.publicBaseUrl
    );
    const privateBaseUrl = required(
      'SPONSOR_MEDIA_PRIVATE_BASE_URL',
      config.privateBaseUrl
    );
    const accessKeyId = required('OVH_S3_ACCESS_KEY_ID', config.accessKeyId);
    const secretAccessKey = required(
      'OVH_S3_SECRET_ACCESS_KEY',
      config.secretAccessKey
    );

    assertNoTrailingSlash('SPONSOR_MEDIA_ENDPOINT', endpoint);
    assertNoTrailingSlash('SPONSOR_MEDIA_PUBLIC_BASE_URL', publicBaseUrl);
    assertNoTrailingSlash('SPONSOR_MEDIA_PRIVATE_BASE_URL', privateBaseUrl);

    this.privateBucket = privateBucket;
    this.client = new S3Client({
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      endpoint,
      region
    });
  }

  async readLogo(filename: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.privateBucket,
          Key: this.objectKey(filename)
        })
      );

      return responseBodyToBuffer(response.Body);
    } catch (error) {
      if (isS3NotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async writeLogo(input: SponsorLogoWriteInput): Promise<void> {
    if (await this.objectExists(input.filename)) {
      throw new Error('Sponsor logo object already exists.');
    }

    await this.client.send(
      new PutObjectCommand({
        ACL: 'private',
        Body: input.data,
        Bucket: this.privateBucket,
        CacheControl: 'private, no-store',
        ContentType: input.contentType,
        Key: this.objectKey(input.filename)
      })
    );
  }

  async deleteLogo(filename: string): Promise<boolean> {
    if (!(await this.objectExists(filename))) {
      return false;
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.privateBucket,
        Key: this.objectKey(filename)
      })
    );

    return true;
  }

  private async objectExists(filename: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.privateBucket,
          Key: this.objectKey(filename)
        })
      );
      return true;
    } catch (error) {
      if (isS3NotFoundError(error)) {
        return false;
      }

      throw error;
    }
  }

  private objectKey(filename: string): string {
    assertSafeFilename(filename);

    return `${SPONSOR_LOGO_S3_PREFIX}${filename}`;
  }
}

export const createSponsorLogoStorage = (
  config: SponsorLogoStorageConfig
): SponsorLogoStorage => {
  const driver = normalizeDriver(config.driver);

  if (driver === 'ovh-s3') {
    return new OvhS3SponsorLogoStorage(config.s3);
  }

  return new LocalSponsorLogoStorage(config.localStorageDir);
};
