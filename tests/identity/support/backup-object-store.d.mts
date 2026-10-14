export function startBackupObjectStore(directory: string): Promise<{
  origin: string;
  uploads(): number;
  file(id: string): string;
  stop(): Promise<void>;
}>;
