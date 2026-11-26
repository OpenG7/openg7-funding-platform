export const ADMIN_LOAD_PROFILES = Object.freeze([100, 1000, 10000]);

/** Fixed disposable profiles only; no target URL, credentials or provider switches. */
export function parseAdminLoadOptions(args) {
  const options = {
    run: false,
    profiles: [...ADMIN_LOAD_PROFILES],
    samples: 3,
    concurrency: 4,
    poolSize: 10,
    statementTimeoutMs: 30000,
    acquireTimeoutMs: 10000
  };
  const seen = new Set();
  for (const arg of args) {
    const [name, raw, extra] = arg.split('=');
    if (seen.has(name) || extra !== undefined)
      throw new Error('Invalid or repeated benchmark option.');
    seen.add(name);
    if (name === '--run' && raw === undefined) {
      options.run = true;
      continue;
    }
    if (name === '--plan' && raw === undefined) {
      continue;
    }
    if (name === '--profiles' && raw) {
      const profiles = raw.split(',');
      if (
        profiles.some((value) => !/^(100|1000|10000)$/.test(value)) ||
        new Set(profiles).size !== profiles.length
      )
        throw new Error(
          'Profiles must be distinct values from 100,1000,10000.'
        );
      options.profiles = profiles.map(Number).sort((a, b) => a - b);
      continue;
    }
    const integers = {
      '--samples': ['samples', 1, 10],
      '--concurrency': ['concurrency', 1, 8],
      '--pool-size': ['poolSize', 1, 16],
      '--statement-timeout-ms': ['statementTimeoutMs', 1000, 60000],
      '--acquire-timeout-ms': ['acquireTimeoutMs', 1000, 30000]
    };
    const field = Object.hasOwn(integers, name) ? integers[name] : undefined;
    if (
      !field ||
      !raw ||
      !/^\d+$/.test(raw) ||
      Number(raw) < field[1] ||
      Number(raw) > field[2]
    )
      throw new Error('Unknown or out-of-bounds benchmark option.');
    options[field[0]] = Number(raw);
  }
  if (seen.has('--run') && seen.has('--plan'))
    throw new Error('Choose run or plan.');
  return Object.freeze(options);
}

export function summarizeLatencies(values) {
  if (!values.length)
    return {
      samples: 0,
      minMs: null,
      medianMs: null,
      p95Ms: null,
      maxMs: null
    };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const round = (value) => Math.round(value * 100) / 100;
  return {
    samples: n,
    minMs: round(sorted[0]),
    medianMs: round(
      n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    ),
    p95Ms: round(sorted[Math.ceil(n * 0.95) - 1]),
    maxMs: round(sorted[n - 1])
  };
}

export function safeLoadFailure(error) {
  const code = error?.code;
  if (code === '57014') return 'STATEMENT_TIMEOUT';
  if (code === '55P03') return 'LOCK_TIMEOUT';
  if (code === 'ERR_ASSERTION') return 'INVARIANT_FAILED';
  if (
    /timeout exceeded when trying to connect|Connection terminated due to connection timeout/.test(
      error?.message ?? ''
    )
  )
    return 'POOL_ACQUIRE_TIMEOUT';
  if (typeof code === 'string' && /^\d{2}[0-9A-Z]{3}$/.test(code))
    return 'POSTGRES_' + code;
  return 'MEASUREMENT_UNAVAILABLE';
}
