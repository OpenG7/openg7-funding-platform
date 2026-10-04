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

export interface SponsorMediaStorage {
  readonly driver: SponsorMediaStorageDriver;
  checkReadAccess?(signal: AbortSignal): Promise<void>;
  deletePrivateObject(key: string): Promise<boolean>;
  deletePublicObject(key: string): Promise<boolean>;
  publishObject(input: SponsorMediaPublishInput): Promise<void>;
  publicUrl(key: string): string | null;
  readPrivateObject(key: string): Promise<Buffer | null>;
  readPublicObject(key: string): Promise<Buffer | null>;
  writePrivateObject(input: SponsorMediaWriteInput): Promise<void>;
}

export interface SponsorMediaWriteInput {
  readonly key: string;
  readonly data: Buffer;
  readonly contentType: string;
}

export interface SponsorMediaPublishInput {
  readonly privateKey: string;
  readonly publicKey: string;
  readonly contentType: string;
}
