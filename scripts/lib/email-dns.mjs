import { createPublicKey } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

// Publication diagnostics, not SPF check_host(), DKIM signature verification or DMARC evaluation.
export function dnsName(value, selector = false) {
  if (typeof value !== 'string') throw new Error('Invalid DNS name.');
  const name = value.toLowerCase().replace(/\.$/, '');
  const labels = name.split('.');
  if (
    name.length > 253 ||
    (!selector && (labels.length < 2 || isIP(name))) ||
    labels.some(
      (part) => !/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/.test(part)
    ) ||
    (!selector && name.includes('_'))
  )
    throw new Error('Invalid DNS name.');
  return name;
}

const issue = (code, severity = 'error') => ({ code, severity });
const result = (issues = [], details = {}) => ({
  status: issues.some((i) => i.severity === 'error')
    ? 'failed'
    : issues.length
      ? 'review'
      : 'passed',
  ...details,
  issues
});
function single(records, matches) {
  const selected = records.filter(matches);
  return selected.length === 1
    ? selected[0]
    : result([issue(selected.length ? 'multiple_records' : 'record_missing')]);
}
function tags(text) {
  if (/[^\x20-\x7e\t]/.test(text)) throw new Error('Invalid text.');
  const parts = text.split(';');
  if (parts.at(-1).trim() === '') parts.pop();
  const values = new Map();
  for (const part of parts) {
    const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(part);
    if (!match || values.has(match[1])) throw new Error('Invalid tags.');
    values.set(match[1], match[2]);
  }
  return values;
}

export function inspectSpf(records) {
  const record = single(records, (r) => /^v=spf1(?: |$)/i.test(r));
  if (typeof record !== 'string') return record;
  if (/[^\x20-\x7e]/.test(record)) return result([issue('spf_syntax')]);
  const issues = [],
    modifiers = new Set();
  const terms = record.trimEnd().split(/ +/).slice(1);
  let all = false,
    lookups = 0,
    indirect = false;
  const domainSpec = (value) => {
    if (value?.includes('%')) {
      issues.push(issue('spf_macros_not_evaluated', 'review'));
      return true;
    }
    // SPF dependencies commonly use labels such as _spf; they are not hostnames.
    const labels = value?.replace(/\.$/, '').split('.') ?? [];
    return (
      value?.length <= 253 &&
      labels.length >= 2 &&
      labels.every((part) =>
        /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(part)
      )
    );
  };
  for (const term of terms) {
    const modifier = /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(term);
    if (modifier) {
      const name = modifier[1].toLowerCase();
      if (modifiers.has(name) || !modifier[2])
        issues.push(issue('spf_modifier_invalid'));
      modifiers.add(name);
      if (['redirect', 'exp'].includes(name) && !domainSpec(modifier[2]))
        issues.push(issue('spf_domain_invalid'));
      if (name === 'redirect') {
        lookups++;
        indirect = true;
      }
      continue;
    }
    const match = /^([+?~-]?)([a-z0-9]+)(.*)$/i.exec(term);
    if (!match) {
      issues.push(issue('spf_syntax'));
      continue;
    }
    const [, qualifier, rawName, argument] = match,
      name = rawName.toLowerCase();
    if (all) issues.push(issue('spf_unreachable_term', 'review'));
    if (name === 'all' && !argument) {
      all = true;
      if (!qualifier || qualifier === '+')
        issues.push(issue('spf_allows_every_sender'));
      else if (qualifier !== '-')
        issues.push(issue('spf_non_rejecting_all', 'review'));
    } else if (['ip4', 'ip6'].includes(name)) {
      const parts = argument.startsWith(':')
        ? argument.slice(1).split('/')
        : [];
      const version = name === 'ip4' ? 4 : 6,
        max = version === 4 ? 32 : 128;
      if (
        parts.length < 1 ||
        parts.length > 2 ||
        isIP(parts[0]) !== version ||
        (parts[1] !== undefined &&
          (!/^\d{1,3}$/.test(parts[1]) || Number(parts[1]) > max))
      )
        issues.push(issue('spf_ip_invalid'));
    } else if (['include', 'exists'].includes(name)) {
      lookups++;
      indirect = true;
      if (!argument.startsWith(':') || !domainSpec(argument.slice(1)))
        issues.push(issue('spf_domain_invalid'));
    } else if (['a', 'mx', 'ptr'].includes(name)) {
      lookups++;
      indirect = true;
      // Macro expressions can contain slashes; do not pretend to parse their expansion.
      if (argument.includes('%')) {
        domainSpec(argument);
        continue;
      }
      const m = /^(?::([^/]+))?(?:\/(\d{1,2}))?(?:\/\/(\d{1,3}))?$/.exec(
        argument
      );
      if (
        !m ||
        (m[1] && !domainSpec(m[1])) ||
        Number(m[2] ?? 0) > 32 ||
        Number(m[3] ?? 0) > 128 ||
        (name === 'ptr' && (m?.[2] || m?.[3]))
      )
        issues.push(issue('spf_mechanism_invalid'));
      if (name === 'ptr') issues.push(issue('spf_ptr_discouraged', 'review'));
    } else issues.push(issue('spf_mechanism_unknown'));
  }
  if (all && modifiers.has('redirect'))
    issues.push(issue('spf_redirect_ignored', 'review'));
  if (!all && !modifiers.has('redirect'))
    issues.push(issue('spf_implicit_neutral', 'review'));
  // Evaluation can stop before later terms; a static count is only a review hint.
  if (lookups - (all && modifiers.has('redirect') ? 1 : 0) > 10)
    issues.push(issue('spf_many_lookup_terms', 'review'));
  if (indirect) issues.push(issue('spf_dependencies_not_evaluated', 'review'));
  return result(deduplicate(issues), { directLookupTerms: lookups });
}

export function inspectDkim(records) {
  const record = single(records, (r) =>
    /(?:^|;)\s*(?:v\s*=\s*DKIM|p\s*=)/.test(r)
  );
  if (typeof record !== 'string') return record;
  let values;
  try {
    values = tags(record);
  } catch {
    return result([issue('dkim_tags_invalid')]);
  }
  if (
    values.has('v') &&
    (values.keys().next().value !== 'v' || values.get('v') !== 'DKIM1')
  )
    return result([issue('dkim_version_invalid')]);
  if (!values.has('p')) return result([issue('dkim_key_missing')]);
  const encoded = values.get('p').replace(/[ \t]/g, '');
  if (!encoded) return result([issue('dkim_key_revoked')]);
  const key = Buffer.from(encoded, 'base64');
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')
  )
    return result([issue('dkim_key_invalid')]);
  const algorithm = values.get('k') ?? 'rsa',
    issues = [];
  let bits;
  if (algorithm === 'rsa') {
    let publicKey;
    // Both commonly published SubjectPublicKeyInfo and RFC RSAPublicKey encodings.
    for (const type of ['spki', 'pkcs1']) {
      try {
        const candidate = createPublicKey({ key, format: 'der', type });
        if (
          candidate.asymmetricKeyType === 'rsa' &&
          candidate.export({ format: 'der', type }).equals(key)
        ) {
          publicKey = candidate;
          break;
        }
      } catch {
        /* Try the other supported DER encoding. */
      }
    }
    if (!publicKey) return result([issue('dkim_key_invalid')]);
    bits = publicKey.asymmetricKeyDetails.modulusLength;
    if (bits < 1024) issues.push(issue('dkim_rsa_too_short'));
    else if (bits < 2048) issues.push(issue('dkim_rsa_below_2048', 'review'));
  } else if (algorithm === 'ed25519') {
    if (key.length !== 32) return result([issue('dkim_key_invalid')]);
    bits = 256;
  } else return result([issue('dkim_algorithm_unsupported', 'review')]);
  const list = (tag) =>
    values
      .get(tag)
      ?.split(':')
      .map((s) => s.trim());
  if (values.has('h') && !list('h').includes('sha256'))
    issues.push(issue('dkim_sha256_unavailable'));
  if (values.has('s') && !list('s').some((s) => ['*', 'email'].includes(s)))
    issues.push(issue('dkim_email_service_unavailable'));
  if (list('t')?.includes('y'))
    issues.push(issue('dkim_testing_mode', 'review'));
  return result(issues, { algorithm, bits });
}

export function inspectDmarc(records) {
  const record = single(records, (r) => /^v\s*=\s*DMARC1(?:\s*;|\s*$)/.test(r));
  if (typeof record !== 'string') {
    // No automatic organizational-domain guessing: a parent policy may still apply.
    if (record.issues[0].code === 'record_missing')
      return result([
        issue('dmarc_direct_record_missing_parent_not_checked', 'review')
      ]);
    return record;
  }
  let values;
  try {
    values = tags(record);
  } catch {
    return result([issue('dmarc_tags_invalid')]);
  }
  const issues = [],
    policies = ['none', 'quarantine', 'reject'];
  for (const [tag, choices] of [
    ['p', policies],
    ['sp', policies],
    ['np', policies],
    ['adkim', ['r', 's']],
    ['aspf', ['r', 's']],
    ['t', ['y', 'n']],
    ['psd', ['y', 'n', 'u']]
  ])
    if (values.has(tag) && !choices.includes(values.get(tag).toLowerCase()))
      issues.push(issue('dmarc_policy_value_invalid', 'review'));
  // RFC 9989: missing p defaults to none. This is a review, not invalid syntax.
  const p = values.get('p')?.toLowerCase();
  const policy = policies.includes(p) ? p : 'none';
  if (policy === 'none') issues.push(issue('dmarc_monitoring_only', 'review'));
  if (values.get('t')?.toLowerCase() === 'y')
    issues.push(issue('dmarc_testing_mode', 'review'));
  // pct is obsolete in RFC 9989; older receivers can still apply it.
  if (values.has('pct')) issues.push(issue('dmarc_legacy_pct', 'review'));
  if (values.get('psd')?.toLowerCase() === 'y')
    issues.push(issue('dmarc_public_suffix_policy', 'review'));
  return result(deduplicate(issues), { policy });
}

function deduplicate(issues) {
  return [...new Map(issues.map((i) => [i.code, i])).values()];
}

export async function diagnoseEmailDns({
  domain,
  spfDomain,
  dkimDomain,
  selectors,
  server,
  timeoutMs = 3000
}) {
  domain = dnsName(domain);
  spfDomain = dnsName(spfDomain ?? domain);
  dkimDomain = dnsName(dkimDomain ?? domain);
  if (!Array.isArray(selectors) || !selectors.length || selectors.length > 5)
    throw new Error('Selectors required.');
  selectors = selectors.map((s) => dnsName(s, true));
  if (
    new Set(selectors).size !== selectors.length ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 10000
  )
    throw new Error('Invalid limits.');
  const requests = [
    { kind: 'spf', name: spfDomain, inspect: inspectSpf },
    { kind: 'dmarc', name: '_dmarc.' + domain, inspect: inspectDmarc },
    ...selectors.map((s) => ({
      kind: 'dkim',
      name: s + '._domainkey.' + dkimDomain,
      inspect: inspectDkim
    }))
  ];
  if (requests.some((r) => r.name.length > 253))
    throw new Error('DNS name too long.');
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  if (server) resolver.setServers([server]); // Numeric address, optional port; no hostname lookup.
  // Hard overall bound as well as the resolver's per-query timeout. All reads are concurrent.
  const timer = setTimeout(() => resolver.cancel(), timeoutMs + 500);
  try {
    const checks = await Promise.all(
      requests.map(async ({ kind, name, inspect }) => {
        try {
          const records = await resolver.resolveTxt(name + '.');
          if (
            records.length > 50 ||
            records.reduce((n, parts) => n + parts.join('').length, 0) > 32768
          )
            return {
              kind,
              name,
              status: 'incomplete',
              issues: [issue('dns_response_limit')]
            };
          // TXT character-strings belong to one RR; concatenate without adding spaces.
          return {
            kind,
            name,
            ...inspect(records.map((parts) => parts.join('')))
          };
        } catch (error) {
          if (['ENOTFOUND', 'ENODATA'].includes(error.code))
            return { kind, name, ...inspect([]) };
          const code = ['ETIMEOUT', 'ECANCELLED'].includes(error.code)
            ? 'dns_timeout'
            : 'dns_lookup_failed';
          return { kind, name, status: 'incomplete', issues: [issue(code)] };
        }
      })
    );
    const status =
      ['incomplete', 'failed', 'review'].find((s) =>
        checks.some((c) => c.status === s)
      ) ?? 'passed';
    return {
      version: 1,
      checkedAt: new Date().toISOString(),
      scope: 'dns_publication_diagnostic',
      readOnly: true,
      domain,
      spfDomain,
      dkimDomain,
      resolver: server ? 'explicit' : 'system',
      status,
      checks,
      limitations: [
        'spf_sender_ip_and_dependencies_not_evaluated',
        'dkim_message_signature_not_verified',
        'dmarc_parent_discovery_alignment_and_reporting_not_verified',
        'dnssec_and_global_propagation_not_verified',
        'smtp_and_inbox_delivery_not_verified'
      ]
    };
  } finally {
    clearTimeout(timer);
    resolver.cancel();
  }
}
