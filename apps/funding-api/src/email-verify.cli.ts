import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadTransactionalEmailConfig,
  toTransactionalEmailError,
  verifyEmailTransport,
  type CreateEmailTransport
} from './services/email/index.js';

interface EmailVerifyCliOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly createTransport?: CreateEmailTransport;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
}

const isMainModule = (moduleUrl: string): boolean =>
  process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === moduleUrl
    : false;

export const runEmailVerifyCli = async (
  options: EmailVerifyCliOptions = {}
): Promise<number> => {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;

  try {
    const config = loadTransactionalEmailConfig(env);
    stdout('SMTP configuration loaded.');
    await verifyEmailTransport({
      env,
      createTransport: options.createTransport
    });
    stdout(`SMTP connection verified successfully for ${config.user}.`);
    return 0;
  } catch (error) {
    const emailError = toTransactionalEmailError(error);
    stderr(
      `SMTP connection verification failed: ${emailError.code}. ${emailError.message}`
    );
    return 1;
  }
};

if (isMainModule(import.meta.url)) {
  const exitCode = await runEmailVerifyCli();
  process.exitCode = exitCode;
}
