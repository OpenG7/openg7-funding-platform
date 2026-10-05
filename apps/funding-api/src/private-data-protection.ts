import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const prefix = 'og7enc:v1:';
const envelopeKey = '__openg7Encrypted';

/** This key belongs to the API, separately from database and provider credentials. */
export const privateDataEncryptionKey = (
  env: NodeJS.ProcessEnv = process.env
): Buffer | null => {
  const configured = env.FUNDING_PRIVATE_DATA_ENCRYPTION_KEY;
  const production =
    (env.FUNDING_PLATFORM_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase() ===
    'production';
  if (!configured) {
    if (production) throw new Error('PRIVATE_DATA_ENCRYPTION_KEY_REQUIRED');
    return null;
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(configured))
    throw new Error('PRIVATE_DATA_ENCRYPTION_KEY_INVALID');
  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32 || key.toString('base64') !== configured)
    throw new Error('PRIVATE_DATA_ENCRYPTION_KEY_INVALID');
  return key;
};

export const protectPrivateText = (
  value: string,
  context: string,
  env: NodeJS.ProcessEnv = process.env
): string => {
  const key = privateDataEncryptionKey(env);
  if (!key) return value;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ]);
  return (
    prefix +
    Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      'base64url'
    )
  );
};

export const revealPrivateText = (
  value: string,
  context: string,
  env: NodeJS.ProcessEnv = process.env
): string => {
  if (!value.startsWith(prefix)) return value; // Explicit legacy compatibility.
  try {
    const key = privateDataEncryptionKey(env);
    if (!key) throw new Error();
    const encoded = value.slice(prefix.length);
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.length < 28 || bytes.toString('base64url') !== encoded)
      throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(context, 'utf8'));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final()
    ]).toString('utf8');
  } catch {
    // Never expose the value, key, provider input or underlying crypto error.
    throw new Error('PRIVATE_DATA_DECRYPTION_FAILED');
  }
};

export const protectPrivateJson = <T>(
  value: T,
  context: string,
  env: NodeJS.ProcessEnv = process.env
): T | Record<typeof envelopeKey, string> => {
  if (!privateDataEncryptionKey(env)) return value;
  return {
    [envelopeKey]: protectPrivateText(JSON.stringify(value), context, env)
  };
};

export const revealPrivateJson = <T>(
  value: unknown,
  context: string,
  env: NodeJS.ProcessEnv = process.env
): T => {
  if (value && typeof value === 'object' && envelopeKey in value) {
    const ciphertext = (value as Record<string, unknown>)[envelopeKey];
    if (typeof ciphertext !== 'string' || !ciphertext.startsWith(prefix))
      throw new Error('PRIVATE_DATA_DECRYPTION_FAILED');
    try {
      return JSON.parse(revealPrivateText(ciphertext, context, env)) as T;
    } catch {
      throw new Error('PRIVATE_DATA_DECRYPTION_FAILED');
    }
  }
  return value as T;
};

// SQL joins require these identifiers. Content, URLs and arbitrary metadata are private.
const emailCorrelationKeys = new Set([
  'actor',
  'contributionId',
  'publicReference',
  'invoiceId',
  'creditNoteId',
  'stripeSessionId',
  'stripePaymentIntentId',
  'activityId'
]);

export const protectEmailMetadata = (
  value: Record<string, unknown>,
  id: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, unknown> => {
  if (!privateDataEncryptionKey(env)) return value;
  const correlation: Record<string, unknown> = {};
  const content: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (
      emailCorrelationKeys.has(name) &&
      typeof item === 'string' &&
      /^[A-Za-z0-9_.:@-]{1,200}$/.test(item)
    )
      correlation[name] = item;
    else content[name] = item;
  }
  return {
    ...correlation,
    [envelopeKey]: protectPrivateText(
      JSON.stringify(content),
      `email:${id}:metadata`,
      env
    )
  };
};

export const revealEmailMetadata = (
  value: unknown,
  id: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  if (!(envelopeKey in metadata)) return metadata;
  const { [envelopeKey]: ciphertext, ...correlation } = metadata;
  return {
    ...correlation,
    ...revealPrivateJson<Record<string, unknown>>(
      { [envelopeKey]: ciphertext },
      `email:${id}:metadata`,
      env
    )
  };
};
