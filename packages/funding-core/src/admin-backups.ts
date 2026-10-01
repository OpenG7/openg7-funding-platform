/** Metadata only: archives, credentials and storage paths never cross this API. */
export interface AdminDatabaseBackup {
  readonly requestId: string;
  readonly source: 'manual' | 'daily';
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly retainUntil: string | null;
}

export interface AdminBackupsResponse {
  readonly scope: 'database';
  readonly schedule: 'daily';
  readonly retentionDays: 30;
  readonly workerState: 'not_configured' | 'ready' | 'unavailable';
  readonly checkedAt: string;
  readonly lastWorkerAt: string | null;
  readonly jobs: readonly AdminDatabaseBackup[];
  /** Included when looking up a request, including null for a missing receipt. */
  readonly request?: AdminDatabaseBackup | null;
}

export interface AdminBackupRequest {
  readonly requestId: string;
  readonly confirmation: 'BACKUP_DATABASE';
}
