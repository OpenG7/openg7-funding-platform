import { createHash } from 'node:crypto';

import sharp from 'sharp';
import type { Pool } from 'pg';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';

export interface MediaSourceAttestation {
  readonly version: string;
  readonly checksum: string;
  readonly valid: boolean;
}
/** Provider reads and decoding happen outside command transactions, four at a time. */
export async function attestMediaSources(
  pool: Pick<Pool, 'query'>,
  storage: Pick<SponsorMediaStorage, 'readPrivateObject'>,
  contributionId: string,
  ids: readonly string[]
): Promise<ReadonlyMap<string, MediaSourceAttestation>> {
  const result = await pool.query<{
    id: string;
    version: string;
    checksum_sha256: string;
    processed_storage_key: string;
    processed_size_bytes: number;
    width: number;
    height: number;
  }>(
    `SELECT id,updated_at::text AS version,checksum_sha256,processed_storage_key,processed_size_bytes,width,height FROM sponsor_media_assets WHERE contribution_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL`,
    [contributionId, ids]
  );
  const attestations = new Map<string, MediaSourceAttestation>();
  for (let offset = 0; offset < result.rows.length; offset += 4) {
    await Promise.all(
      result.rows.slice(offset, offset + 4).map(async (row) => {
        let valid = false;
        try {
          const bytes = await storage.readPrivateObject(
            row.processed_storage_key
          );
          if (
            bytes &&
            bytes.length === row.processed_size_bytes &&
            createHash('sha256').update(bytes).digest('hex') ===
              row.checksum_sha256
          ) {
            const metadata = await sharp(bytes, {
              failOn: 'warning',
              limitInputPixels: 40_000_000
            }).metadata();
            valid =
              metadata.format === 'webp' &&
              metadata.width === row.width &&
              metadata.height === row.height;
          }
        } catch {
          /* Unavailable or corrupt bytes cannot support an authorization. */
        }
        attestations.set(row.id, {
          version: row.version,
          checksum: row.checksum_sha256,
          valid
        });
      })
    );
  }
  return attestations;
}
