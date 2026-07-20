import {
  TransactionalEmailError,
  type EmailAddressIdentity,
  type TransactionalEmailConfig,
  type TransactionalEmailConfigStatus
} from './email.types.js';

const defaultSmtpHost = 'mail.papamail.net';
const defaultSmtpPort = 465;
const defaultSmtpSecure = true;
const defaultFromName = 'OpenG7';
const defaultFromAddress = 'notify@openg7.org';
const defaultReplyToName = 'OpenG7';
const defaultReplyToAddress = 'contact@openg7.org';
const defaultConnectionTimeoutMs = 10_000;
const defaultGreetingTimeoutMs = 10_000;
const defaultSocketTimeoutMs = 20_000;
const emailAddressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const readEnv = (env: NodeJS.ProcessEnv, name: string, fallback = ''): string =>
  env[name]?.trim() ?? fallback;

const parseBooleanEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
): boolean => {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new TransactionalEmailError(
    'EMAIL_CONFIGURATION_ERROR',
    `${name} must be a boolean value.`
  );
};

const parsePositiveIntegerEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number => {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TransactionalEmailError(
      'EMAIL_CONFIGURATION_ERROR',
      `${name} must be a positive integer.`
    );
  }

  return parsed;
};

const assertValidEmailAddress = (name: string, value: string): void => {
  if (!emailAddressPattern.test(value)) {
    throw new TransactionalEmailError(
      'EMAIL_CONFIGURATION_ERROR',
      `${name} must be a valid email address.`
    );
  }
};

const formatEmailAddress = (name: string, address: string): string => {
  if (/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/.test(name)) {
    return `${name} <${address}>`;
  }

  const safeName = name.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return safeName ? `"${safeName}" <${address}>` : address;
};

const createEmailIdentity = (
  addressKey: string,
  name: string,
  address: string
): EmailAddressIdentity => {
  const normalizedAddress = address.toLowerCase();
  assertValidEmailAddress(addressKey, normalizedAddress);

  return {
    name,
    address: normalizedAddress,
    formatted: formatEmailAddress(name, normalizedAddress)
  };
};

export const isValidEmailAddress = (value: string): boolean =>
  emailAddressPattern.test(value.trim());

export const maskEmailAddress = (value: string): string => {
  const [localPart = '', domain = ''] = value.split('@');
  if (!localPart || !domain) {
    return '[invalid-email]';
  }

  const visibleLocal =
    localPart.length <= 2
      ? `${localPart[0] ?? ''}*`
      : `${localPart.slice(0, 2)}***`;
  return `${visibleLocal}@${domain}`;
};

export const loadTransactionalEmailConfig = (
  env: NodeJS.ProcessEnv = process.env
): TransactionalEmailConfig => {
  const enabled = parseBooleanEnv(env, 'SMTP_ENABLED', false);
  const host = readEnv(env, 'SMTP_HOST', defaultSmtpHost);
  const port = parsePositiveIntegerEnv(env, 'SMTP_PORT', defaultSmtpPort);
  const secure = parseBooleanEnv(env, 'SMTP_SECURE', defaultSmtpSecure);
  const user = readEnv(env, 'SMTP_USER', defaultFromAddress).toLowerCase();
  const password = readEnv(env, 'SMTP_PASSWORD');
  const from = createEmailIdentity(
    'MAIL_FROM_ADDRESS',
    readEnv(env, 'MAIL_FROM_NAME', defaultFromName),
    readEnv(env, 'MAIL_FROM_ADDRESS', defaultFromAddress)
  );
  const replyTo = createEmailIdentity(
    'MAIL_REPLY_TO_ADDRESS',
    readEnv(env, 'MAIL_REPLY_TO_NAME', defaultReplyToName),
    readEnv(env, 'MAIL_REPLY_TO_ADDRESS', defaultReplyToAddress)
  );
  const connectionTimeoutMs = parsePositiveIntegerEnv(
    env,
    'SMTP_CONNECTION_TIMEOUT_MS',
    defaultConnectionTimeoutMs
  );
  const greetingTimeoutMs = parsePositiveIntegerEnv(
    env,
    'SMTP_GREETING_TIMEOUT_MS',
    defaultGreetingTimeoutMs
  );
  const socketTimeoutMs = parsePositiveIntegerEnv(
    env,
    'SMTP_SOCKET_TIMEOUT_MS',
    defaultSocketTimeoutMs
  );

  if (user) {
    assertValidEmailAddress('SMTP_USER', user);
  }

  if (enabled) {
    if (!host) {
      throw new TransactionalEmailError(
        'EMAIL_CONFIGURATION_ERROR',
        'SMTP_HOST is required when SMTP_ENABLED=true.'
      );
    }

    if (!user) {
      throw new TransactionalEmailError(
        'EMAIL_CONFIGURATION_ERROR',
        'SMTP_USER is required when SMTP_ENABLED=true.'
      );
    }

    if (!password) {
      throw new TransactionalEmailError(
        'EMAIL_CONFIGURATION_ERROR',
        'SMTP_PASSWORD is required when SMTP_ENABLED=true.'
      );
    }
  }

  return {
    enabled,
    host,
    port,
    secure,
    user,
    password,
    from,
    replyTo,
    connectionTimeoutMs,
    greetingTimeoutMs,
    socketTimeoutMs
  };
};

export const getTransactionalEmailConfigStatus = (
  env: NodeJS.ProcessEnv = process.env
): TransactionalEmailConfigStatus => {
  const config = loadTransactionalEmailConfig(env);

  return {
    enabled: config.enabled,
    configured:
      config.enabled &&
      Boolean(config.host) &&
      Boolean(config.user) &&
      Boolean(config.password),
    host: config.host || null,
    port: config.port,
    secure: config.secure,
    userConfigured: Boolean(config.user),
    passwordConfigured: Boolean(config.password),
    from: config.from.formatted,
    replyTo: config.replyTo.formatted
  };
};
