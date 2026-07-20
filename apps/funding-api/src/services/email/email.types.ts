export type EmailDeliveryMode = 'disabled' | 'smtp';

export type EmailErrorCode =
  | 'EMAIL_DISABLED'
  | 'EMAIL_CONFIGURATION_ERROR'
  | 'EMAIL_CONNECTION_ERROR'
  | 'EMAIL_AUTHENTICATION_ERROR'
  | 'EMAIL_SEND_ERROR'
  | 'EMAIL_RECIPIENT_REJECTED';

export interface EmailAddressIdentity {
  readonly name: string;
  readonly address: string;
  readonly formatted: string;
}

export interface TransactionalEmailConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly from: EmailAddressIdentity;
  readonly replyTo: EmailAddressIdentity;
  readonly connectionTimeoutMs: number;
  readonly greetingTimeoutMs: number;
  readonly socketTimeoutMs: number;
}

export interface TransactionalEmailConfigStatus {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly host: string | null;
  readonly port: number;
  readonly secure: boolean;
  readonly userConfigured: boolean;
  readonly passwordConfigured: boolean;
  readonly from: string;
  readonly replyTo: string;
}

export interface SendTransactionalEmailInput {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
  readonly headers?: Record<string, string>;
}

export interface SendTransactionalEmailResult {
  readonly messageId?: string;
  readonly accepted: string[];
  readonly rejected: string[];
  readonly deliveryMode: EmailDeliveryMode;
}

export interface EmailTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly auth: {
    readonly user: string;
    readonly pass: string;
  };
  readonly connectionTimeout: number;
  readonly greetingTimeout: number;
  readonly socketTimeout: number;
}

export interface EmailMessageOptions {
  readonly from: string;
  readonly to: string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly replyTo?: string;
  readonly headers?: Record<string, string>;
}

export interface EmailSendInfo {
  readonly messageId?: string;
  readonly accepted?: readonly unknown[];
  readonly rejected?: readonly unknown[];
  readonly response?: string;
}

export interface EmailTransport {
  verify(): Promise<unknown>;
  sendMail(message: EmailMessageOptions): Promise<EmailSendInfo>;
}

export type CreateEmailTransport = (
  options: EmailTransportOptions
) => EmailTransport;

export interface EmailServiceDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly createTransport?: CreateEmailTransport;
  readonly logger?: Pick<Console, 'error' | 'info'>;
}

export class TransactionalEmailError extends Error {
  readonly code: EmailErrorCode;
  readonly smtpCode: string | number | null;

  constructor(
    code: EmailErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly smtpCode?: string | number | null;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'TransactionalEmailError';
    this.code = code;
    this.smtpCode = options.smtpCode ?? null;
  }
}
