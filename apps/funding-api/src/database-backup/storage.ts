import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  S3Client,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3';

import type { BackupConfig } from './config.js';

export interface BackupProof {
  bytes: number;
  sha256: string;
  retainUntil: string;
}

export class BackupStorage {
  readonly client: S3Client;
  constructor(private readonly config: BackupConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      forcePathStyle: true,
      maxAttempts: 1
    });
  }
  key(id: string) {
    return `${this.config.namespace}/database/${id}.sql.age`;
  }

  async check(signal: AbortSignal) {
    const Bucket = this.config.bucket;
    const options = { abortSignal: signal };
    const lock = await this.client.send(
      new GetObjectLockConfigurationCommand({ Bucket }),
      options
    );
    const versions = await this.client.send(
      new GetBucketVersioningCommand({ Bucket }),
      options
    );
    if (
      lock.ObjectLockConfiguration?.ObjectLockEnabled !== 'Enabled' ||
      versions.Status !== 'Enabled'
    )
      throw new Error('BACKUP_STORAGE_UNPROTECTED');
    const acl = await this.client.send(
      new GetBucketAclCommand({ Bucket }),
      options
    );
    if (
      !acl.Owner?.ID ||
      !acl.Grants?.length ||
      acl.Grants?.some(
        (grant) =>
          grant.Grantee?.Type !== 'CanonicalUser' ||
          grant.Grantee.ID !== acl.Owner!.ID
      )
    )
      throw new Error('BACKUP_STORAGE_NOT_PRIVATE');
    try {
      // Dedicated buckets use identity permissions. Any bucket policy requires an operator review.
      const policy = await this.client.send(
        new GetBucketPolicyCommand({ Bucket }),
        options
      );
      if (policy.Policy) throw new Error('BACKUP_STORAGE_POLICY_REVIEW');
    } catch (error) {
      if ((error as { name?: string }).name !== 'NoSuchBucketPolicy')
        throw error;
    }
  }

  async upload(
    id: string,
    file: string,
    proof: BackupProof,
    signal: AbortSignal
  ) {
    const body = createReadStream(file);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(id),
          Body: body,
          ContentLength: proof.bytes,
          ContentType: 'application/octet-stream',
          IfNoneMatch: '*',
          ChecksumSHA256: Buffer.from(proof.sha256, 'hex').toString('base64'),
          Metadata: {
            sha256: proof.sha256,
            'request-id': id,
            scope: 'database',
            encryption: 'age'
          },
          ObjectLockMode: 'COMPLIANCE',
          ObjectLockRetainUntilDate: new Date(proof.retainUntil)
        }),
        { abortSignal: signal }
      );
    } finally {
      body.destroy();
    }
    await this.verify(id, proof, signal);
  }

  async verify(id: string, proof: BackupProof, signal: AbortSignal) {
    const target = { Bucket: this.config.bucket, Key: this.key(id) };
    const head = await this.client.send(new HeadObjectCommand(target), {
      abortSignal: signal
    });
    if (
      !head.VersionId ||
      head.VersionId === 'null' ||
      head.ContentLength !== proof.bytes ||
      head.Metadata?.sha256 !== proof.sha256 ||
      head.Metadata?.['request-id'] !== id ||
      head.ObjectLockMode !== 'COMPLIANCE' ||
      !head.ObjectLockRetainUntilDate ||
      head.ObjectLockRetainUntilDate.getTime() < Date.parse(proof.retainUntil)
    )
      throw new Error('BACKUP_VERIFICATION_FAILED');
    // Read the pinned version: an upload response or metadata alone does not prove its contents.
    const object = await this.client.send(
      new GetObjectCommand({ ...target, VersionId: head.VersionId }),
      { abortSignal: signal }
    );
    const hash = createHash('sha256');
    let bytes = 0;
    if (!object.Body) throw new Error('BACKUP_VERIFICATION_FAILED');
    const body = object.Body as NodeJS.ReadableStream &
      AsyncIterable<Buffer> & { destroy(): void };
    try {
      for await (const chunk of body) {
        signal.throwIfAborted();
        bytes += chunk.length;
        if (bytes > proof.bytes) throw new Error('BACKUP_VERIFICATION_FAILED');
        hash.update(chunk);
      }
    } finally {
      body.destroy();
    }
    if (bytes !== proof.bytes || hash.digest('hex') !== proof.sha256)
      throw new Error('BACKUP_VERIFICATION_FAILED');
  }
}
