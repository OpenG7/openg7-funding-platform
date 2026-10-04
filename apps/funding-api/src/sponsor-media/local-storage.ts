import {
  access,
  copyFile,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import type {
  SponsorLogoStorage,
  SponsorLogoWriteInput,
  SponsorMediaStorage,
  SponsorMediaWriteInput,
  SponsorMediaPublishInput
} from './storage-contracts.js';
import { assertSafeFilename, assertSafeObjectKey } from './storage-policy.js';

export class LocalSponsorLogoStorage implements SponsorLogoStorage {
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

export class LocalSponsorMediaStorage implements SponsorMediaStorage {
  readonly driver = 'local' as const;

  private readonly privateDir: string;
  private readonly publicDir: string;

  constructor(storageDir: string) {
    const root = path.resolve(storageDir);
    this.privateDir = path.join(root, 'media-assets', 'private');
    this.publicDir = path.join(root, 'media-assets', 'public');
  }

  async checkReadAccess(): Promise<void> {
    const root = path.resolve(this.privateDir, '..', '..');
    if (!(await stat(root)).isDirectory())
      throw new Error('Storage directory unavailable');
    await access(root, constants.R_OK | constants.X_OK);
  }

  readPrivateObject(key: string): Promise<Buffer | null> {
    return this.readObject(this.privateDir, key);
  }

  readPublicObject(key: string): Promise<Buffer | null> {
    return this.readObject(this.publicDir, key);
  }

  writePrivateObject(input: SponsorMediaWriteInput): Promise<void> {
    return this.writeObject(this.privateDir, input.key, input.data);
  }

  async publishObject(input: SponsorMediaPublishInput): Promise<void> {
    const source = this.resolveObjectPath(this.privateDir, input.privateKey);
    const target = this.resolveObjectPath(this.publicDir, input.publicKey);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target, 1);
  }

  deletePrivateObject(key: string): Promise<boolean> {
    return this.deleteObject(this.privateDir, key);
  }

  deletePublicObject(key: string): Promise<boolean> {
    return this.deleteObject(this.publicDir, key);
  }

  publicUrl(): string | null {
    return null;
  }

  private async readObject(root: string, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveObjectPath(root, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async writeObject(
    root: string,
    key: string,
    data: Buffer
  ): Promise<void> {
    const filePath = this.resolveObjectPath(root, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data, { flag: 'wx' });
  }

  private async deleteObject(root: string, key: string): Promise<boolean> {
    try {
      await unlink(this.resolveObjectPath(root, key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private resolveObjectPath(root: string, key: string): string {
    assertSafeObjectKey(key);
    const resolved = path.resolve(root, ...key.split('/'));
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error(
        'Sponsor media key resolved outside the storage directory.'
      );
    }
    return resolved;
  }
}
