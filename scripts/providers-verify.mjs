import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import Stripe from 'stripe';
import { runEmailVerifyCli } from '../dist/apps/funding-api/src/email-verify.cli.js';

const defaultChecks = {
  stripe: async (env) => {
    await new Stripe(env.STRIPE_SECRET_KEY, {
      timeout: 10000,
      maxNetworkRetries: 0
    }).balance.retrieve();
  },
  smtp: async (env) => {
    const status = await runEmailVerifyCli({
      env,
      stdout: () => {},
      stderr: () => {}
    });
    if (status !== 0) throw new Error('SMTP verification failed');
  },
  s3: async (env, bucketKey) => {
    const client = new S3Client({
      region: env.SPONSOR_MEDIA_REGION,
      endpoint: env.SPONSOR_MEDIA_ENDPOINT,
      maxAttempts: 1,
      credentials: {
        accessKeyId: env.OVH_S3_ACCESS_KEY_ID,
        secretAccessKey: env.OVH_S3_SECRET_ACCESS_KEY
      }
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: env[bucketKey] }), {
        abortSignal: AbortSignal.timeout(10000)
      });
    } finally {
      client.destroy();
    }
  }
};

/** Read-only rehearsal checks. Results contain fixed labels, never provider payloads. */
export async function verifyProviders(env, checks = defaultChecks) {
  const check = async (service, configured, run) => {
    if (!configured) return { service, status: 'not_configured' };
    try {
      await run();
      return { service, status: 'verified' };
    } catch {
      return { service, status: 'failed' };
    }
  };
  const s3Configured =
    env.SPONSOR_MEDIA_STORAGE_DRIVER === 'ovh-s3' &&
    /^https:\/\//.test(env.SPONSOR_MEDIA_ENDPOINT ?? '') &&
    env.SPONSOR_MEDIA_REGION &&
    env.OVH_S3_ACCESS_KEY_ID &&
    env.OVH_S3_SECRET_ACCESS_KEY;
  return Promise.all([
    check(
      'stripe_test_authentication',
      env.STRIPE_SECRET_KEY?.startsWith('sk_test_'),
      () => checks.stripe(env)
    ),
    check(
      'smtp_authentication',
      ['true', '1'].includes(env.SMTP_ENABLED?.toLowerCase()),
      () => checks.smtp(env)
    ),
    ...['PRIVATE', 'PUBLIC'].map((kind) =>
      check(
        `s3_${kind.toLowerCase()}_bucket_access`,
        s3Configured && env[`SPONSOR_MEDIA_${kind}_BUCKET`],
        () => checks.s3(env, `SPONSOR_MEDIA_${kind}_BUCKET`)
      )
    )
  ]);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--env') {
    console.error(
      'Usage: node scripts/providers-verify.mjs --env <configuration-file>'
    );
    process.exitCode = 2;
  } else {
    try {
      const env = parseEnv(await readFile(args[1], 'utf8'));
      const checks = await verifyProviders(env);
      console.log(
        JSON.stringify(
          {
            checked_at: new Date().toISOString(),
            scope: 'read_only_authentication',
            checks
          },
          null,
          2
        )
      );
      process.exitCode = checks.every((c) => c.status === 'verified') ? 0 : 1;
    } catch {
      console.error(
        'Provider verification could not load its configuration. Build the API and check the selected file.'
      );
      process.exitCode = 1;
    }
  }
}
