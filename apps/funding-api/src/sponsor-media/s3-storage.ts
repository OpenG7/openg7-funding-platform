import {
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

import type {
  SponsorLogoStorage,
  SponsorLogoWriteInput,
  SponsorLogoS3StorageConfig,
  SponsorMediaStorage,
  SponsorMediaWriteInput,
  SponsorMediaPublishInput
} from './storage-contracts.js';
import {
  SPONSOR_LOGO_S3_PREFIX,
  required,
  assertNoTrailingSlash,
  assertSafeFilename,
  assertSafeObjectKey
} from './storage-policy.js';
import { isS3NotFoundError, responseBodyToBuffer } from './s3-response.js';

export class OvhS3SponsorLogoStorage implements SponsorLogoStorage {
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

export class OvhS3SponsorMediaStorage implements SponsorMediaStorage {
  readonly driver = 'ovh-s3' as const;

  private readonly client: S3Client;
  private readonly privateBucket: string;
  private readonly publicBucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: SponsorLogoS3StorageConfig) {
    const region = required('SPONSOR_MEDIA_REGION', config.region);
    const endpoint = required('SPONSOR_MEDIA_ENDPOINT', config.endpoint);
    this.privateBucket = required(
      'SPONSOR_MEDIA_PRIVATE_BUCKET',
      config.privateBucket
    );
    this.publicBucket = required(
      'SPONSOR_MEDIA_PUBLIC_BUCKET',
      config.publicBucket
    );
    this.publicBaseUrl = required(
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
    assertNoTrailingSlash('SPONSOR_MEDIA_PUBLIC_BASE_URL', this.publicBaseUrl);
    assertNoTrailingSlash('SPONSOR_MEDIA_PRIVATE_BASE_URL', privateBaseUrl);

    this.client = new S3Client({
      credentials: { accessKeyId, secretAccessKey },
      endpoint,
      region
    });
  }

  readPrivateObject(key: string): Promise<Buffer | null> {
    return this.readObject(this.privateBucket, key);
  }

  async checkReadAccess(signal: AbortSignal): Promise<void> {
    await Promise.all(
      [this.privateBucket, this.publicBucket].map((Bucket) =>
        this.client.send(new HeadBucketCommand({ Bucket }), {
          abortSignal: signal
        })
      )
    );
  }

  readPublicObject(key: string): Promise<Buffer | null> {
    return this.readObject(this.publicBucket, key);
  }

  async writePrivateObject(input: SponsorMediaWriteInput): Promise<void> {
    assertSafeObjectKey(input.key);
    if (await this.objectExists(this.privateBucket, input.key)) {
      throw new Error('Sponsor media object already exists.');
    }
    await this.client.send(
      new PutObjectCommand({
        ACL: 'private',
        Body: input.data,
        Bucket: this.privateBucket,
        CacheControl: 'private, no-store',
        ContentType: input.contentType,
        Key: input.key
      })
    );
  }

  async publishObject(input: SponsorMediaPublishInput): Promise<void> {
    assertSafeObjectKey(input.privateKey);
    assertSafeObjectKey(input.publicKey);
    if (await this.objectExists(this.publicBucket, input.publicKey)) {
      throw new Error('Published sponsor media object already exists.');
    }
    await this.client.send(
      new CopyObjectCommand({
        ACL: 'public-read',
        Bucket: this.publicBucket,
        CacheControl: 'public, max-age=31536000, immutable',
        ContentType: input.contentType,
        CopySource: `${this.privateBucket}/${input.privateKey
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        Key: input.publicKey,
        MetadataDirective: 'REPLACE'
      })
    );
  }

  deletePrivateObject(key: string): Promise<boolean> {
    return this.deleteObject(this.privateBucket, key);
  }

  deletePublicObject(key: string): Promise<boolean> {
    return this.deleteObject(this.publicBucket, key);
  }

  publicUrl(key: string): string {
    assertSafeObjectKey(key);
    return `${this.publicBaseUrl}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  private async readObject(
    bucket: string,
    key: string
  ): Promise<Buffer | null> {
    assertSafeObjectKey(key);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      return responseBodyToBuffer(response.Body);
    } catch (error) {
      if (isS3NotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async objectExists(bucket: string, key: string): Promise<boolean> {
    assertSafeObjectKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      );
      return true;
    } catch (error) {
      if (isS3NotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async deleteObject(bucket: string, key: string): Promise<boolean> {
    if (!(await this.objectExists(bucket, key))) {
      return false;
    }
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key })
    );
    return true;
  }
}
