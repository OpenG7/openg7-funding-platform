import nodemailer from 'nodemailer';

import {
  isValidEmailAddress,
  loadTransactionalEmailConfig,
  maskEmailAddress
} from './email.config.js';
import {
  TransactionalEmailError,
  type CreateEmailTransport,
  type EmailErrorCode,
  type EmailMessageOptions,
  type EmailSendInfo,
  type EmailServiceDependencies,
  type EmailTransportOptions,
  type SendTransactionalEmailInput,
  type SendTransactionalEmailResult,
  type TransactionalEmailConfig
} from './email.types.js';

const defaultLogger: Pick<Console, 'error' | 'info'> = console;

const createTransportOptions = (
  config: TransactionalEmailConfig
): EmailTransportOptions => ({
  host: config.host,
  port: config.port,
  secure: config.secure,
  auth: {
    user: config.user,
    pass: config.password
  },
  connectionTimeout: config.connectionTimeoutMs,
  greetingTimeout: config.greetingTimeoutMs,
  socketTimeout: config.socketTimeoutMs
});

const defaultCreateTransport: CreateEmailTransport = (options) => {
  const transporter = nodemailer.createTransport(options);

  return {
    verify: () => transporter.verify(),
    sendMail: (message: EmailMessageOptions) => transporter.sendMail(message)
  };
};

const normalizeRecipients = (
  value: SendTransactionalEmailInput['to']
): string[] =>
  (Array.isArray(value) ? [...value] : [value]).map((to) => to.trim());

const assertValidRecipients = (recipients: readonly string[]): void => {
  if (recipients.length === 0) {
    throw new TransactionalEmailError(
      'EMAIL_CONFIGURATION_ERROR',
      'At least one email recipient is required.'
    );
  }

  for (const recipient of recipients) {
    if (!isValidEmailAddress(recipient)) {
      throw new TransactionalEmailError(
        'EMAIL_CONFIGURATION_ERROR',
        'Email recipient must be a valid email address.'
      );
    }
  }
};

const toStringArray = (value: readonly unknown[] | undefined): string[] =>
  (value ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : String(entry)))
    .filter(Boolean);

const getSafeSmtpCode = (error: unknown): string | number | null => {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as {
    readonly code?: unknown;
    readonly responseCode?: unknown;
    readonly statusCode?: unknown;
  };

  if (
    typeof candidate.responseCode === 'number' ||
    typeof candidate.responseCode === 'string'
  ) {
    return candidate.responseCode;
  }

  if (
    typeof candidate.statusCode === 'number' ||
    typeof candidate.statusCode === 'string'
  ) {
    return candidate.statusCode;
  }

  return typeof candidate.code === 'string' ? candidate.code : null;
};

export const toTransactionalEmailError = (
  error: unknown
): TransactionalEmailError => {
  if (error instanceof TransactionalEmailError) {
    return error;
  }

  const smtpCode = getSafeSmtpCode(error);
  const smtpCodeText = String(smtpCode ?? '').toUpperCase();
  let code: EmailErrorCode = 'EMAIL_SEND_ERROR';
  let message = 'Transactional email could not be sent.';

  if (
    smtpCodeText === 'EAUTH' ||
    smtpCodeText === '535' ||
    smtpCodeText === '534'
  ) {
    code = 'EMAIL_AUTHENTICATION_ERROR';
    message = 'SMTP authentication failed.';
  } else if (
    smtpCodeText === 'ECONNECTION' ||
    smtpCodeText === 'ETIMEDOUT' ||
    smtpCodeText === 'ESOCKET'
  ) {
    code = 'EMAIL_CONNECTION_ERROR';
    message = 'SMTP connection failed.';
  }

  return new TransactionalEmailError(code, message, {
    cause: error,
    smtpCode
  });
};

const resolveCreateTransport = (
  dependencies: EmailServiceDependencies
): CreateEmailTransport =>
  dependencies.createTransport ?? defaultCreateTransport;

const resolveLogger = (
  dependencies: EmailServiceDependencies
): Pick<Console, 'error' | 'info'> => dependencies.logger ?? defaultLogger;

export const verifyEmailTransport = async (
  dependencies: EmailServiceDependencies = {}
): Promise<void> => {
  const config = loadTransactionalEmailConfig(dependencies.env);

  if (!config.enabled) {
    throw new TransactionalEmailError(
      'EMAIL_DISABLED',
      'SMTP delivery is disabled. Set SMTP_ENABLED=true to verify the transport.'
    );
  }

  try {
    const transport = resolveCreateTransport(dependencies)(
      createTransportOptions(config)
    );
    await transport.verify();
  } catch (error) {
    throw toTransactionalEmailError(error);
  }
};

export const sendTransactionalEmail = async (
  input: SendTransactionalEmailInput,
  dependencies: EmailServiceDependencies = {}
): Promise<SendTransactionalEmailResult> => {
  const config = loadTransactionalEmailConfig(dependencies.env);
  const logger = resolveLogger(dependencies);
  const recipients = normalizeRecipients(input.to);
  const startedAt = Date.now();

  assertValidRecipients(recipients);

  if (input.replyTo && !isValidEmailAddress(input.replyTo)) {
    throw new TransactionalEmailError(
      'EMAIL_CONFIGURATION_ERROR',
      'Email reply-to override must be a valid email address.'
    );
  }

  if (!config.enabled) {
    logger.info(
      'Transactional email delivery skipped because SMTP is disabled.',
      {
        deliveryMode: 'disabled',
        recipient: recipients.map(maskEmailAddress),
        durationMs: Date.now() - startedAt
      }
    );

    return {
      accepted: [],
      rejected: recipients,
      deliveryMode: 'disabled'
    };
  }

  const message: EmailMessageOptions = {
    from: config.from.formatted,
    to: recipients,
    replyTo: input.replyTo ?? config.replyTo.formatted,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
    ...(input.headers ? { headers: input.headers } : {})
  };

  try {
    const transport = resolveCreateTransport(dependencies)(
      createTransportOptions(config)
    );
    const info: EmailSendInfo = await transport.sendMail(message);
    const accepted = toStringArray(info.accepted);
    const rejected = toStringArray(info.rejected);

    logger.info('Transactional email sent.', {
      acceptedCount: accepted.length,
      deliveryMode: 'smtp',
      durationMs: Date.now() - startedAt,
      messageId: info.messageId,
      recipient: recipients.map(maskEmailAddress),
      rejectedCount: rejected.length
    });

    return {
      ...(info.messageId ? { messageId: info.messageId } : {}),
      accepted,
      rejected,
      deliveryMode: 'smtp'
    };
  } catch (error) {
    const emailError = toTransactionalEmailError(error);
    logger.error('Transactional email failed.', {
      code: emailError.code,
      deliveryMode: 'smtp',
      durationMs: Date.now() - startedAt,
      recipient: recipients.map(maskEmailAddress),
      smtpCode: emailError.smtpCode
    });
    throw emailError;
  }
};
