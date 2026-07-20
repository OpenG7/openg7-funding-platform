import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadTransactionalEmailConfig,
  renderSmtpConfigurationTestEmail,
  sendTransactionalEmail,
  toTransactionalEmailError,
  type CreateEmailTransport
} from './services/email/index.js';

interface EmailTestCliOptions {
  readonly argv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly createTransport?: CreateEmailTransport;
  readonly logger?: Pick<Console, 'error' | 'info'>;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
}

const isMainModule = (moduleUrl: string): boolean =>
  process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === moduleUrl
    : false;

export const getEmailTestRecipientFromArgs = (
  argv: readonly string[]
): string | null => {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--to') {
      return argv[index + 1]?.trim() || null;
    }

    if (arg.startsWith('--to=')) {
      return arg.slice('--to='.length).trim() || null;
    }
  }

  return null;
};

export const runEmailTestCli = async (
  options: EmailTestCliOptions = {}
): Promise<number> => {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const to = getEmailTestRecipientFromArgs(argv);

  if (!to) {
    stderr(
      'A test recipient is required. Usage: npm run email:test -- --to=adresse@example.com'
    );
    return 1;
  }

  try {
    const config = loadTransactionalEmailConfig(env);
    const template = renderSmtpConfigurationTestEmail({
      fromAddress: config.from.address,
      replyToAddress: config.replyTo.address
    });
    const result = await sendTransactionalEmail(
      {
        to,
        ...template
      },
      {
        env,
        createTransport: options.createTransport,
        logger: options.logger
      }
    );

    if (result.deliveryMode !== 'smtp' || result.accepted.length === 0) {
      stderr(
        `SMTP test message was not sent. deliveryMode=${result.deliveryMode}`
      );
      return 1;
    }

    stdout(`SMTP test message sent to ${to}.`);
    stdout(`messageId=${result.messageId ?? 'unavailable'}`);
    return 0;
  } catch (error) {
    const emailError = toTransactionalEmailError(error);
    stderr(
      `SMTP test message failed: ${emailError.code}. ${emailError.message}`
    );
    return 1;
  }
};

if (isMainModule(import.meta.url)) {
  const exitCode = await runEmailTestCli();
  process.exitCode = exitCode;
}
