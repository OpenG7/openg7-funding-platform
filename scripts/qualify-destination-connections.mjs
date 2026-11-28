import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  feedIds,
  feedConfig
} from '../dist/apps/funding-api/src/publication-automation/policy.js';
import { checkConnection } from '../dist/apps/funding-api/src/publication-automation/provider.js';
import { isSocialPublicationChannelConfigured } from '../dist/apps/funding-api/src/social-publication.service.js';

const usage =
  'Usage: node scripts/qualify-destination-connections.mjs --env <file> [--feed <destination>] [--check]';

export function parseQualificationArguments(args) {
  const options = { check: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--env', '--feed', '--check'].includes(flag) || seen.has(flag))
      throw new Error('INVALID_ARGUMENTS');
    seen.add(flag);
    if (flag === '--check') options.check = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new Error('INVALID_ARGUMENTS');
      options[flag.slice(2)] = value;
    }
  }
  if (!options.env || (options.feed && !feedIds.includes(options.feed)))
    throw new Error('INVALID_ARGUMENTS');
  return options;
}

/** No DB access, stored status changes, sends, or provider payloads in the report. */
export async function qualifyDestinationConnections(
  env,
  { check = false, feed, now = new Date(), verify = checkConnection } = {}
) {
  if (typeof check !== 'boolean') throw new Error('INVALID_CHECK_MODE');
  if (feed !== undefined && !feedIds.includes(feed))
    throw new Error('INVALID_DESTINATION');
  const observedAt = now.toISOString();
  const destinations = [];
  // Sequential, bounded to the four existing destinations; no automatic retries.
  for (const id of feed ? [feed] : feedIds) {
    let credentials;
    try {
      credentials = feedConfig(id, { ...env });
    } catch {
      destinations.push({
        feedId: id,
        status: 'invalid_configuration',
        attemptedAt: null
      });
      continue;
    }
    const { config, accountId, expiresAt } = credentials;
    const channel = id.split(':')[1];
    const expiry = !expiresAt
      ? 'unknown'
      : !Number.isFinite(Date.parse(expiresAt))
        ? 'invalid'
        : Date.parse(expiresAt) <= now.getTime()
          ? 'expired'
          : 'future';
    const result = {
      feedId: id,
      mode: config.mode,
      expiry,
      status: 'not_checked',
      attemptedAt: null
    };
    destinations.push(result);
    if (config.mode === 'disabled') {
      result.status = 'disabled';
      continue;
    }
    if (config.mode === 'mock') {
      result.status = 'simulation';
      continue;
    }
    if (!isSocialPublicationChannelConfigured(config, channel)) {
      result.status = 'missing_configuration';
      continue;
    }
    if (['expired', 'invalid'].includes(expiry)) {
      result.status = 'blocked_expiry';
      continue;
    }
    // Never send a server token to a custom endpoint from this qualification CLI.
    const endpoint =
      channel === 'facebook'
        ? config.facebook.graphBaseUrl
        : config.linkedin.apiBaseUrl;
    let allowed = false;
    try {
      const url = new URL(endpoint);
      allowed =
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (!url.port || url.port === '443') &&
        url.hostname ===
          (channel === 'facebook' ? 'graph.facebook.com' : 'api.linkedin.com');
    } catch {
      /* Fixed diagnostic below, never print the URL. */
    }
    if (!allowed) {
      result.status = 'blocked_endpoint';
      continue;
    }
    if (!check) continue;
    result.attemptedAt = new Date().toISOString();
    try {
      await verify(config, channel, accountId);
      result.status = 'account_access_verified';
    } catch {
      // Errors can contain secrets or private provider bodies; expose neither.
      result.status = 'check_failed';
    }
  }
  return {
    observedAt,
    scope: check ? 'read_only_account_access' : 'configuration_plan_no_network',
    destinations,
    unverified: [
      'publishing_permissions',
      'application_access',
      'credential_renewal',
      'destination_activation',
      'publication_authorization'
    ]
  };
}

export async function runQualificationCli(
  args,
  {
    read = readFile,
    qualify = qualifyDestinationConnections,
    stdout = (value) => console.log(value),
    stderr = (value) => console.error(value)
  } = {}
) {
  let options;
  try {
    options = parseQualificationArguments(args);
  } catch {
    stderr(usage);
    return 2;
  }
  try {
    // Only the named file is read: never inherit shell secrets or load .env.
    const env = parseEnv(await read(options.env, 'utf8'));
    const report = await qualify(env, {
      check: options.check,
      feed: options.feed
    });
    stdout(JSON.stringify(report, null, 2));
    return options.check &&
      report.destinations.some((d) => d.status !== 'account_access_verified')
      ? 1
      : 0;
  } catch {
    stderr('DESTINATION_QUALIFICATION_UNAVAILABLE');
    return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runQualificationCli(process.argv.slice(2));
}
