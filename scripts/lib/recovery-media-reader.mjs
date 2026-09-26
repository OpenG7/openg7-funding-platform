// Builtins only: this module is also evaluated in an isolated, read-only local-media container.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

export const maxObjectBytes = 64 * 1024 * 1024;
export const safeKey = (key) =>
  typeof key === 'string' &&
  key.length <= 1024 &&
  key
    .split('/')
    .every(
      (part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'
    );

export async function fingerprintStream(stream, reference) {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > maxObjectBytes) return { status: 'limit' };
      hash.update(chunk);
    }
    const digest = hash.digest('hex');
    return {
      status:
        (reference.bytes !== null && bytes !== reference.bytes) ||
        (reference.sha256 && digest !== reference.sha256)
          ? 'mismatch'
          : 'verified'
    };
  } finally {
    stream.destroy();
  }
}

export async function readLocalMedia(references, root) {
  const results = [];
  for (const reference of references) {
    if (!safeKey(reference.path)) {
      results.push({ status: 'unsafe_key' });
      continue;
    }
    try {
      let file = root;
      const parts = reference.path.split('/');
      for (let index = 0; index < parts.length; index++) {
        file = join(file, parts[index]);
        const entry = await lstat(file);
        if (
          entry.isSymbolicLink() ||
          (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())
        )
          throw new Error('Unsafe media entry.');
      }
      results.push(await fingerprintStream(createReadStream(file), reference));
    } catch (error) {
      results.push({
        status: error.code === 'ENOENT' ? 'missing' : 'unreadable'
      });
    }
  }
  return results;
}
