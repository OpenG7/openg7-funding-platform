export interface AdminBackupsBrowser {
  now(): number;
  randomUUID(): string;
  readPendingId(): string | null;
  writePendingId(id: string | null): void;
}

const storageKey = 'openg7-backup-request';

/** Browser recovery is optional; creating the adapter reads no browser globals. */
export function createAdminBackupsBrowser(): AdminBackupsBrowser {
  return {
    now: () => Date.now(),
    randomUUID: () => crypto.randomUUID(),
    readPendingId: () => {
      try {
        const id = sessionStorage.getItem(storageKey);
        return id && /^[a-f0-9-]{36}$/i.test(id) ? id : null;
      } catch {
        return null;
      }
    },
    writePendingId: (id) => {
      try {
        if (id) sessionStorage.setItem(storageKey, id);
        else sessionStorage.removeItem(storageKey);
      } catch {
        /* The server still deduplicates requests when storage is unavailable. */
      }
    }
  };
}
