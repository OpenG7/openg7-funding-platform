#!/usr/bin/env node
import { diagnoseEmailDns } from './lib/email-dns.mjs';

const usage = `Usage: yarn email:dns --domain <from-domain> --selector <dkim-selector> [--selector <next-selector>]
  [--spf-domain <mail-from-domain>] [--dkim-domain <signing-domain>]
  [--resolver <ip[:port]>] [--timeout-ms <100..10000>]
Read-only TXT publication checks using Node 22. Domains must be ASCII/Punycode.
No .env, SMTP connection, email, DNS changes or selector guessing.
JSON stdout contains names and fixed findings, never raw TXT, public keys or reporting addresses.
Exit 0: no finding within this limited scope; 2: findings/review; 1: incomplete or invalid arguments.
This does not prove message authentication or inbox delivery.
`;
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
  } else {
    if (Number(process.versions.node.split('.')[0]) !== 22)
      throw new Error('Node 22 required.');
    const names = {
      '--domain': 'domain',
      '--spf-domain': 'spfDomain',
      '--dkim-domain': 'dkimDomain',
      '--resolver': 'server',
      '--timeout-ms': 'timeoutMs'
    };
    const options = { selectors: [] };
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i],
        value = args[i + 1];
      if (!value || value.startsWith('--'))
        throw new Error('Missing argument.');
      if (flag === '--selector') options.selectors.push(value);
      else if (Object.hasOwn(names, flag) && options[names[flag]] === undefined)
        options[names[flag]] = value;
      else throw new Error('Invalid argument.');
    }
    if (options.timeoutMs !== undefined) {
      if (!/^\d+$/.test(options.timeoutMs)) throw new Error('Invalid timeout.');
      options.timeoutMs = Number(options.timeoutMs);
    }
    const report = await diagnoseEmailDns(options);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode =
      report.status === 'passed' ? 0 : report.status === 'incomplete' ? 1 : 2;
  }
} catch {
  console.error(
    'DNS diagnostic refused or incomplete. Check explicit arguments and Node 22; use --help.'
  );
  process.exitCode = 1;
}
