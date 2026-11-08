import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync
} from 'node:fs';

import {
  loadPreflightConfig,
  PreflightConfigurationError,
  type PreflightConfig
} from './config.js';

export interface PreflightInboxConfig {
  readonly connection: PreflightConfig;
  readonly consoleUrl: string | null;
}

function consoleUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new PreflightConfigurationError('preflight_console_url_invalid');
  }
}

/** Read a bounded regular secret file; failures disclose neither its path nor its contents. */
function clientSecret(env: NodeJS.ProcessEnv): string | undefined {
  const path = env.PREFLIGHT_CLIENT_SECRET_FILE;
  if (!path) return env.PREFLIGHT_CLIENT_SECRET;
  if (env.PREFLIGHT_CLIENT_SECRET)
    throw new PreflightConfigurationError('preflight_client_secret_ambiguous');
  let descriptor: number | undefined;
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error();
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size > 4096 ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
    )
      throw new Error();
    const buffer = Buffer.alloc(4097);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (length > 4096) throw new Error();
    const value = buffer.subarray(0, length).toString('utf8').trim();
    if (!value || /[\r\n\u0000]/.test(value)) throw new Error();
    return value;
  } catch {
    throw new PreflightConfigurationError(
      'preflight_client_secret_file_invalid'
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Inbox activation never changes PREFLIGHT_ENABLED, reserved for the durable connector. */
export function loadPreflightInboxConfig(
  env: NodeJS.ProcessEnv = process.env
): PreflightInboxConfig {
  const enabled = env.PREFLIGHT_INBOX_ENABLED;
  if (enabled != null && enabled !== 'true' && enabled !== 'false')
    throw new PreflightConfigurationError('preflight_inbox_enabled_invalid');
  return {
    consoleUrl: consoleUrl(env.PREFLIGHT_CONSOLE_URL),
    connection: loadPreflightConfig({
      ...env,
      PREFLIGHT_ENABLED: enabled === 'true' ? 'true' : 'false',
      ...(enabled === 'true'
        ? { PREFLIGHT_CLIENT_SECRET: clientSecret(env) }
        : {})
    })
  };
}
