#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { exit } from 'node:process';

const eventIdPattern = /^evt_[A-Za-z0-9]+$/;

const usage = `Usage:
  yarn stripe:events:resend evt_... [evt_...] [--live] [--endpoint we_...] [--dry-run]
  yarn stripe:events:resend:live evt_... [evt_...] [--endpoint we_...]

Options:
  --live                       Use Stripe live mode. Test mode is the default.
  --endpoint, --webhook-endpoint we_...
                               Target one Stripe webhook endpoint.
  --api-key sk_...             Use an explicit Stripe API key.
  --dry-run                    Print commands without sending events.
  --prompt                     Do not pass --confirm to Stripe CLI.
`;

const rawArgs = process.argv.slice(2);
const eventIds = [];
let live = false;
let webhookEndpoint = process.env.STRIPE_WEBHOOK_ENDPOINT_ID ?? '';
let apiKey = '';
let dryRun = false;
let confirm = true;

const readValue = (args, index, name) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`Missing value for ${name}.`);
    console.error(usage);
    exit(1);
  }

  return value;
};

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];

  if (arg === '--help' || arg === '-h') {
    console.log(usage);
    exit(0);
  }

  if (arg === '--live') {
    live = true;
    continue;
  }

  if (arg === '--dry-run') {
    dryRun = true;
    continue;
  }

  if (arg === '--prompt') {
    confirm = false;
    continue;
  }

  if (arg === '--endpoint' || arg === '--webhook-endpoint') {
    webhookEndpoint = readValue(rawArgs, index, arg);
    index += 1;
    continue;
  }

  if (arg.startsWith('--endpoint=')) {
    webhookEndpoint = arg.slice('--endpoint='.length);
    continue;
  }

  if (arg.startsWith('--webhook-endpoint=')) {
    webhookEndpoint = arg.slice('--webhook-endpoint='.length);
    continue;
  }

  if (arg === '--api-key') {
    apiKey = readValue(rawArgs, index, arg);
    index += 1;
    continue;
  }

  if (arg.startsWith('--api-key=')) {
    apiKey = arg.slice('--api-key='.length);
    continue;
  }

  if (arg.startsWith('--')) {
    console.error(`Unknown option: ${arg}`);
    console.error(usage);
    exit(1);
  }

  eventIds.push(
    ...arg
      .split(',')
      .map((eventId) => eventId.trim())
      .filter(Boolean)
  );
}

const invalidEventIds = eventIds.filter(
  (eventId) => !eventIdPattern.test(eventId)
);

if (eventIds.length === 0 || invalidEventIds.length > 0) {
  if (invalidEventIds.length > 0) {
    console.error(`Invalid Stripe event id(s): ${invalidEventIds.join(', ')}`);
  }

  console.error(usage);
  exit(1);
}

for (const eventId of eventIds) {
  const args = ['events', 'resend', eventId];

  if (confirm) {
    args.push('--confirm');
  }

  if (live) {
    args.push('--live');
  }

  if (webhookEndpoint) {
    args.push('--webhook-endpoint', webhookEndpoint);
  }

  if (apiKey) {
    args.push('--api-key', apiKey);
  }

  if (dryRun) {
    console.log(`stripe ${args.join(' ')}`);
    continue;
  }

  console.log(`Resending ${eventId}${live ? ' in live mode' : ''}...`);
  const result = spawnSync('stripe', args, {
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    console.error(result.error.message);
    exit(1);
  }

  if (result.status !== 0) {
    exit(result.status ?? 1);
  }
}
