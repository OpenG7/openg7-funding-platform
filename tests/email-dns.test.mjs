import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  inspectSpf,
  inspectDkim,
  inspectDmarc
} from '../scripts/lib/email-dns.mjs';
import { startEmailDnsServer } from './support/email-dns-server.mjs';

const script = fileURLToPath(
  new URL('../scripts/email-dns.mjs', import.meta.url)
);
const rsa = (bits, type = 'spki') =>
  generateKeyPairSync('rsa', { modulusLength: bits })
    .publicKey.export({ type, format: 'der' })
    .toString('base64');
const publicKey = rsa(2048);
const rawEdKey = generateKeyPairSync('ed25519')
  .publicKey.export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('base64');
const chunks = (record) => record.match(/.{1,180}/g);
const codes = (check) => check.issues.map((i) => i.code);
const defaults = () => ({
  'mail.example.test': { txt: [['v=spf1 ip4:192.0.2.0/24 -all']] },
  '_dmarc.mail.example.test': { txt: [['v=DMARC1; p=reject']] },
  's1._domainkey.mail.example.test': {
    txt: [chunks('v=DKIM1; p=' + publicKey)]
  }
});
const cli = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        timeout: 15000,
        maxBuffer: 128 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          MAIL_FROM_ADDRESS: 'ignored@wrong.invalid',
          SMTP_PASSWORD: 'synthetic-secret-must-not-appear'
        }
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr,
          report: stdout.startsWith('{') ? JSON.parse(stdout) : null
        });
      }
    );
  });
const run = (server, extra = []) =>
  cli([
    '--domain',
    'mail.example.test',
    '--selector',
    's1',
    '--resolver',
    server,
    ...extra
  ]);

test('DNS CLI end to end: split TXT, separate identities, selector rotation, CNAME and TCP fallback', async (t) => {
  const entries = {
    'return.example.test': {
      txt: [
        ['site-verification=synthetic-secret-must-not-appear'],
        ['v=spf1 ip4:192.0.2.0/', '24 ip6:2001:db8::/32 -all']
      ]
    },
    '_dmarc.mail.example.test': {
      txt: [['v=DMARC1; p=reject; rua=mailto:private-report@example.test']]
    },
    's1._domainkey.signer.example.test': {
      cname: 'key.provider.test',
      tcp: true,
      txt: [chunks('v=DKIM1; k=rsa; p=' + publicKey)]
    },
    's2._domainkey.signer.example.test': { txt: [['k=ed25519; p=' + rawEdKey]] }
  };
  const dns = await startEmailDnsServer(t, entries);
  const output = await run(dns.server, [
    '--spf-domain',
    'return.example.test',
    '--dkim-domain',
    'signer.example.test',
    '--selector',
    's2'
  ]);
  assert.equal(output.code, 0, output.stdout + output.stderr);
  assert.equal(output.report.status, 'passed');
  assert.equal(output.report.readOnly, true);
  assert.equal(output.report.checks.length, 4);
  assert.deepEqual(
    output.report.checks.filter((c) => c.kind === 'dkim').map((c) => c.bits),
    [2048, 256]
  );
  assert.ok(dns.requests.some((q) => q.transport === 'tcp'));
  assert.ok(
    dns.requests.every((q) => q.type === 16 && Object.hasOwn(entries, q.name))
  );
  assert.deepEqual(
    [...new Set(dns.requests.map((q) => q.name))].sort(),
    Object.keys(entries).sort()
  );
  for (const privateText of [
    publicKey,
    rawEdKey,
    'private-report@',
    'synthetic-secret',
    'wrong.invalid'
  ])
    assert.equal((output.stdout + output.stderr).includes(privateText), false);
  assert.ok(
    output.report.limitations.includes('smtp_and_inbox_delivery_not_verified')
  );
});

test('DNS CLI end to end: duplicate SPF/DMARC and revoked DKIM fail with fixed findings', async (t) => {
  const entries = defaults();
  entries['mail.example.test'].txt.push(['v=spf1 -all']);
  entries['_dmarc.mail.example.test'].txt.push(['v=DMARC1; p=none']);
  entries['s1._domainkey.mail.example.test'].txt = [['v=DKIM1; p=']];
  const dns = await startEmailDnsServer(t, entries),
    output = await run(dns.server);
  assert.equal(output.code, 2);
  assert.equal(output.report.status, 'failed');
  assert.deepEqual(output.report.checks.map(codes), [
    ['multiple_records'],
    ['multiple_records'],
    ['dkim_key_revoked']
  ]);
});

test('DNS CLI end to end: NXDOMAIN and NODATA differ from transient failure and do not invent parent policy', async (t) => {
  const dns = await startEmailDnsServer(t, {
    'mail.example.test': { txt: [] }
  });
  const output = await run(dns.server);
  assert.equal(output.code, 2);
  assert.deepEqual(output.report.checks.map(codes), [
    ['record_missing'],
    ['dmarc_direct_record_missing_parent_not_checked'],
    ['record_missing']
  ]);
  assert.equal(dns.requests.length, 3);
});

test('DNS CLI end to end: SERVFAIL and timeout are incomplete, bounded, and never reported as missing', async (t) => {
  const entries = defaults();
  entries['mail.example.test'] = { rcode: 2 };
  entries['_dmarc.mail.example.test'] = { drop: true };
  const dns = await startEmailDnsServer(t, entries),
    started = Date.now();
  const output = await run(dns.server, ['--timeout-ms', '200']);
  assert.equal(output.code, 1);
  assert.equal(output.report.status, 'incomplete');
  assert.deepEqual(output.report.checks.map(codes), [
    ['dns_lookup_failed'],
    ['dns_timeout'],
    []
  ]);
  assert.ok(Date.now() - started < 5000);
  assert.ok(dns.requests.every((q) => Object.hasOwn(entries, q.name)));
});

test('DNS CLI end to end: dependencies, monitoring and DKIM test mode require review', async (t) => {
  const entries = defaults();
  entries['mail.example.test'].txt = [
    ['v=spf1 include:_spf.provider.example.test ~all']
  ];
  entries['_dmarc.mail.example.test'].txt = [['v=DMARC1; p=none; pct=50']];
  entries['s1._domainkey.mail.example.test'].txt = [
    chunks('v=DKIM1; t=y; p=' + publicKey)
  ];
  const dns = await startEmailDnsServer(t, entries),
    output = await run(dns.server);
  assert.equal(output.code, 2);
  assert.equal(output.report.status, 'review');
  assert.ok(output.report.checks.every((c) => c.status === 'review'));
  assert.equal(
    dns.requests.some((q) => q.name === '_spf.provider.example.test'),
    false
  );
});

test('DNS CLI end to end: excessive TXT counts and bytes produce incomplete evidence', async (t) => {
  const entries = defaults();
  entries['mail.example.test'] = {
    tcp: true,
    txt: Array.from({ length: 51 }, () => ['unrelated=value'])
  };
  entries['_dmarc.mail.example.test'] = {
    tcp: true,
    txt: [chunks('x'.repeat(33000))]
  };
  const dns = await startEmailDnsServer(t, entries),
    output = await run(dns.server);
  assert.equal(output.code, 1);
  assert.equal(output.report.status, 'incomplete');
  assert.deepEqual(output.report.checks.map(codes), [
    ['dns_response_limit'],
    ['dns_response_limit'],
    []
  ]);
  assert.ok(output.stdout.length < 4000);
});

test('DNS CLI refuses ambiguous or unsafe input before any DNS query', async (t) => {
  const dns = await startEmailDnsServer(t, defaults());
  for (const args of [
    ['--domain', 'https://secret.invalid'],
    ['--domain', 'person@example.test'],
    ['--domain', '127.0.0.1'],
    ['--domain', 'mail.example.test', '--domain', 'second.example.test'],
    ['--domain', 'mail.example.test', '--selector', 's1', '--selector', 'S1'],
    ['--domain', 'mail.example.test', '--selector', '../secret'],
    ['--domain', 'mail.example.test', '--selector', 's1', '--timeout-ms', '0'],
    [
      '--domain',
      'mail.example.test',
      '--selector',
      's1',
      '--unknown',
      'synthetic-secret'
    ],
    [
      '--domain',
      'mail.example.test',
      ...Array.from({ length: 6 }, (_, i) => ['--selector', 's' + i]).flat()
    ]
  ]) {
    const output = await cli([...args, '--resolver', dns.server]);
    assert.equal(output.code, 1);
    assert.equal(output.report, null);
    assert.equal(output.stderr.includes('secret'), false);
  }
  assert.equal(dns.requests.length, 0);
});

test('SPF publication diagnostics catch malformed and permissive records without claiming sender authorization', () => {
  for (const record of [
    'v=spf1 +all',
    'v=spf1 ip4:192.0.2.1/99 -all',
    'v=spf1 ip6:192.0.2.1 -all',
    'v=spf1 unknown -all',
    'v=spf1 include: -all',
    'v=spf1 redirect=one.test redirect=two.test'
  ])
    assert.equal(inspectSpf([record]).status, 'failed', record);
  assert.equal(inspectSpf(['V=SPF1 IP6:2001:db8::/32 -ALL']).status, 'passed');
  assert.equal(
    inspectSpf(['v=spf1 a/24//64 mx:example.test/24 -all']).status,
    'review'
  );
  assert.equal(
    inspectSpf(['v=spf1 include:_spf.example.test -all']).status,
    'review'
  );
  assert.equal(inspectSpf(['v=spf1 -all ' + 'a '.repeat(11)]).status, 'review');
  assert.ok(
    codes(inspectSpf(['v=spf1 exists:%{i}.example.test -all'])).includes(
      'spf_macros_not_evaluated'
    )
  );
  assert.ok(
    codes(inspectSpf(['v=spf1 -all redirect=example.test'])).includes(
      'spf_redirect_ignored'
    )
  );
  assert.equal(inspectSpf(['v=spf10 -all']).status, 'failed');
});

test('DKIM validates key material, duplicate tags, strength, hash and service restrictions', () => {
  for (const [record, code] of [
    ['v=DKIM1; p=not-a-key', 'dkim_key_invalid'],
    ['v=DKIM1; p=YQ==', 'dkim_key_invalid'],
    ['v=DKIM1; p=one; p=two', 'dkim_tags_invalid'],
    ['p=' + publicKey + '; v=DKIM1', 'dkim_version_invalid'],
    ['k=ed25519; p=YQ==', 'dkim_key_invalid'],
    ['p=' + publicKey + '; h=sha1', 'dkim_sha256_unavailable'],
    ['p=' + publicKey + '; s=other', 'dkim_email_service_unavailable'],
    ['p=' + rsa(512), 'dkim_rsa_too_short']
  ])
    assert.ok(codes(inspectDkim([record])).includes(code), code);
  assert.equal(inspectDkim(['p=' + rsa(1024, 'pkcs1')]).status, 'review');
  assert.equal(inspectDkim(['p=' + rsa(2048, 'pkcs1')]).status, 'passed');
  assert.ok(
    codes(inspectDkim(['p=' + publicKey, 'p=' + publicKey])).includes(
      'multiple_records'
    )
  );
});

test('DMARC distinguishes invalid publication, monitoring, RFC 9989 defaults and legacy pct', () => {
  assert.equal(inspectDmarc(['v=DMARC1; p=reject; p=none']).status, 'failed');
  assert.equal(inspectDmarc(['v=DMARC1']).status, 'review');
  assert.equal(inspectDmarc(['v=DMARC1; p=bogus']).policy, 'none');
  assert.ok(
    codes(inspectDmarc(['v=DMARC1; p=reject; t=y'])).includes(
      'dmarc_testing_mode'
    )
  );
  assert.ok(
    codes(inspectDmarc(['v=DMARC1; p=reject; pct=100'])).includes(
      'dmarc_legacy_pct'
    )
  );
  assert.equal(
    inspectDmarc(['v=DMARC1; p=REJECT; np=none; adkim=s; aspf=r; future=tag'])
      .status,
    'passed'
  );
  assert.equal(inspectDmarc(['v=dmarc1; p=reject']).status, 'review');
});
