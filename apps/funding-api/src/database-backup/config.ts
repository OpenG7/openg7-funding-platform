import { isAbsolute } from 'node:path';

export interface BackupConfig {
  databaseUrl: string;
  directory: string;
  recipient: string;
  namespace: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Worker-only configuration. No archive credentials are passed to the HTTP API. */
export function backupConfig(env: NodeJS.ProcessEnv): BackupConfig | null {
  if (
    env.FUNDING_BACKUP_ENABLED === undefined ||
    env.FUNDING_BACKUP_ENABLED === 'false'
  )
    return null;
  if (env.FUNDING_BACKUP_ENABLED !== 'true')
    throw new Error('Invalid backup enable flag.');
  const required = (name: string) => {
    const value = env[`FUNDING_BACKUP_${name}`]?.trim();
    if (!value || /[\r\n\0]/.test(value))
      throw new Error(`Missing or invalid backup setting: ${name}.`);
    return value;
  };
  const config: BackupConfig = {
    databaseUrl: required('DATABASE_URL'),
    directory: required('DIRECTORY'),
    recipient: required('AGE_RECIPIENT'),
    namespace: required('NAMESPACE'),
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY')
  };
  let database: URL, endpoint: URL;
  try {
    database = new URL(config.databaseUrl);
    endpoint = new URL(config.endpoint);
  } catch {
    throw new Error('Invalid backup connection settings.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname ||
    !database.username ||
    database.pathname.length < 2 ||
    database.hash ||
    [...database.searchParams.keys()].some(
      (key) => !['sslmode', 'sslrootcert'].includes(key)
    ) ||
    (database.searchParams.has('sslmode') &&
      !['verify-full', 'disable'].includes(
        database.searchParams.get('sslmode')!
      ))
  )
    throw new Error('Invalid backup database connection settings.');
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/'
  )
    throw new Error(
      'Backup storage requires an HTTPS origin without credentials.'
    );
  if (
    !isAbsolute(config.directory) ||
    !/^age1[0-9a-z]{58}$/.test(config.recipient) ||
    !/^[a-z0-9][a-z0-9-]{0,39}$/.test(config.namespace) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) ||
    !/^[a-z0-9-]{1,40}$/.test(config.region)
  )
    throw new Error('Invalid backup destination or encryption settings.');
  if (
    database.searchParams.get('sslmode') === 'disable' &&
    !['postgres', 'localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
  ) {
    throw new Error(
      'Unencrypted backup connections are restricted to the private Compose host or loopback.'
    );
  }
  if (!database.searchParams.has('sslmode'))
    database.searchParams.set('sslmode', 'verify-full');
  config.databaseUrl = database.href;
  return config;
}
