import { isAbsolute, resolve } from 'node:path';

import {
  PreflightConfigurationError,
  type EnabledPreflightConfig
} from './config.js';
import { loadPreflightInboxConfig } from './inbox-config.js';

export type PreflightRehearsalConfig =
  | { readonly enabled: false; readonly consoleUrl: string | null }
  | {
      readonly enabled: true;
      readonly consoleUrl: string | null;
      readonly connection: EnabledPreflightConfig;
      readonly storageDir: string;
      readonly publicBaseOrigin: string;
    };

/** An explicitly local recipe. It never activates the Funding business producer. */
export function loadPreflightRehearsalConfig(
  env: NodeJS.ProcessEnv = process.env
): PreflightRehearsalConfig {
  const flag = env.PREFLIGHT_REHEARSAL_ENABLED;
  if (flag !== undefined && flag !== 'true' && flag !== 'false')
    throw new PreflightConfigurationError(
      'preflight_rehearsal_enabled_invalid'
    );
  const shared = loadPreflightInboxConfig({
    ...env,
    PREFLIGHT_INBOX_ENABLED: flag === 'true' ? 'true' : 'false'
  });
  if (flag !== 'true') return { enabled: false, consoleUrl: shared.consoleUrl };
  const environment = env.FUNDING_PLATFORM_ENV;
  if (
    !['development', 'test'].includes(environment ?? '') ||
    !shared.connection.enabled
  )
    throw new PreflightConfigurationError('preflight_rehearsal_local_only');
  let origin: URL;
  try {
    origin = new URL(env.FUNDING_PUBLIC_BASE_URL ?? '');
  } catch {
    throw new PreflightConfigurationError('preflight_rehearsal_local_only');
  }
  const api = new URL(shared.connection.baseUrl),
    token = new URL(shared.connection.tokenUrl);
  const local = (host: string) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const testHost = (host: string) => local(host) || host.endsWith('.test');
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (environment === 'development'
      ? origin.protocol !== 'https:' ||
        origin.hostname !== 'localhost' ||
        !(local(api.hostname) || api.hostname === 'preflight.openg7.test') ||
        token.hostname !== 'auth.openg7.test'
      : !testHost(origin.hostname) ||
        !testHost(api.hostname) ||
        !testHost(token.hostname))
  )
    throw new PreflightConfigurationError('preflight_rehearsal_local_only');
  const storageDir =
    env.PREFLIGHT_REHEARSAL_STORAGE_DIR ?? resolve('var/preflight-rehearsals');
  if (!isAbsolute(storageDir) || storageDir.includes('\0'))
    throw new PreflightConfigurationError(
      'preflight_rehearsal_storage_invalid'
    );
  return {
    enabled: true,
    consoleUrl: shared.consoleUrl,
    connection: shared.connection,
    storageDir,
    publicBaseOrigin: origin.origin
  };
}
