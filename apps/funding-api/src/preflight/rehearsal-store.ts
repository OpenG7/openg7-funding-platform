import { constants } from 'node:fs';
import {
  mkdir,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  link
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

import type { PreflightRehearsalRun } from '@openg7/funding-core';

import type { PreflightMission } from './contracts.js';

export class RehearsalError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503
  ) {
    super(code);
  }
}

export interface StoredRehearsal {
  schemaVersion: 1;
  tenantId: string;
  application: 'funding-platform';
  payload: PreflightMission;
  correlationId: string | null;
  view: PreflightRehearsalRun;
  audit: {
    at: string;
    actor: string;
    action: string;
    result: string;
    correlationId: string;
  }[];
}

const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
const MAX_FILE_BYTES = 512 * 1024;

/** Private single-API local recipe journal. It never accesses Funding business tables. */
export class PreflightRehearsalStore {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(
    readonly directory: string,
    readonly tenantId: string
  ) {}

  async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    this.locks.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === queued) this.locks.delete(key);
    }
  }

  private async root(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      const canonical = await realpath(this.directory);
      const expected = resolve(this.directory);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (process.platform === 'win32'
          ? canonical.toLowerCase() !== expected.toLowerCase()
          : canonical !== expected) ||
        (process.platform !== 'win32' &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
      )
        throw new Error();
    } catch {
      throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_UNAVAILABLE');
    }
  }

  private path(id: string): string {
    if (!validId(id))
      throw new RehearsalError('PREFLIGHT_REHEARSAL_INVALID_REQUEST', 400);
    return join(this.directory, id + '.json');
  }

  private async syncDirectory(): Promise<void> {
    if (process.platform === 'win32') return;
    const directory = await open(this.directory, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private validate(value: unknown, id: string): StoredRehearsal {
    const data = value as StoredRehearsal;
    if (
      !data ||
      data.schemaVersion !== 1 ||
      data.application !== 'funding-platform' ||
      typeof data.tenantId !== 'string' ||
      !data.view ||
      data.view.id !== id ||
      !data.payload ||
      data.payload.tenantId !== data.tenantId ||
      data.payload.missionId !== data.view.missionId ||
      !validId(data.view.missionId) ||
      !validId(data.payload.eventId ?? '') ||
      data.payload.source?.application !== 'funding-platform' ||
      data.payload.source.subjectType !== 'sponsorship-commitment' ||
      data.payload.source.version !== 1 ||
      data.payload.source.subjectId !== data.view.source?.subjectId ||
      !validId(data.payload.source.subjectId) ||
      data.view.synthetic !== true ||
      data.view.expectedSimulation !== true ||
      data.view.authority !== 'source_application' ||
      data.view.businessDecisionExecuted !== false ||
      !Array.isArray(data.view.steps) ||
      data.view.steps.length !== 6 ||
      !Array.isArray(data.view.tasks) ||
      data.view.tasks.length > 50 ||
      !Array.isArray(data.view.proposals) ||
      data.view.proposals.length > 1 ||
      !Array.isArray(data.audit) ||
      data.audit.length > 200
    )
      throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_INVALID');
    if (data.tenantId !== this.tenantId)
      throw new RehearsalError('PREFLIGHT_REHEARSAL_NOT_FOUND', 404);
    return data;
  }

  async read(id: string): Promise<StoredRehearsal | null> {
    await this.root();
    const path = this.path(id);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const stat = await lstat(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_FILE_BYTES ||
        (process.platform !== 'win32' &&
          ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))
      )
        throw new Error();
      handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
      );
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.size > MAX_FILE_BYTES ||
        opened.ino !== stat.ino
      )
        throw new Error();
      return this.validate(JSON.parse(await handle.readFile('utf8')), id);
    } catch (error) {
      if (error instanceof RehearsalError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_INVALID');
    } finally {
      await handle?.close();
    }
  }

  async list(): Promise<StoredRehearsal[]> {
    await this.root();
    const entries = (await readdir(this.directory)).filter((name) =>
      name.endsWith('.json')
    );
    if (entries.length > 100)
      throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_INVALID');
    const runs: StoredRehearsal[] = [];
    for (const name of entries) {
      const id = name.slice(0, -5);
      try {
        const value = await this.read(id);
        if (value) runs.push(value);
      } catch (error) {
        if (!(error instanceof RehearsalError && error.status === 404))
          throw error;
      }
    }
    return runs.sort((a, b) =>
      b.view.createdAt.localeCompare(a.view.createdAt)
    );
  }

  async create(value: StoredRehearsal): Promise<void> {
    await this.locked('create', async () => {
      await this.root();
      const names = (await readdir(this.directory)).filter((name) =>
        name.endsWith('.json')
      );
      if (names.length >= 100)
        throw new RehearsalError('PREFLIGHT_REHEARSAL_CAPACITY_REACHED', 409);
      const data = JSON.stringify(this.validate(value, value.view.id));
      if (Buffer.byteLength(data) > MAX_FILE_BYTES)
        throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_INVALID');
      const temporary = join(this.directory, '.' + randomUUID() + '.tmp');
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, this.path(value.view.id));
        await this.syncDirectory();
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  }

  async save(value: StoredRehearsal): Promise<void> {
    await this.root();
    const data = JSON.stringify(this.validate(value, value.view.id));
    if (Buffer.byteLength(data) > MAX_FILE_BYTES)
      throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_INVALID');
    const target = this.path(value.view.id);
    const existing = await lstat(target);
    if (!existing.isFile() || existing.isSymbolicLink())
      throw new RehearsalError('PREFLIGHT_REHEARSAL_STORAGE_INVALID');
    const temporary = join(this.directory, '.' + randomUUID() + '.tmp');
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
      await this.syncDirectory();
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
