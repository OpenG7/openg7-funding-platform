import assert from 'node:assert/strict';
import test from 'node:test';

const emailModule =
  await import('../dist/apps/funding-api/src/services/email/index.js');
const verifyCliModule =
  await import('../dist/apps/funding-api/src/email-verify.cli.js');
const testCliModule =
  await import('../dist/apps/funding-api/src/email-test.cli.js');

const createEnabledEnv = (overrides = {}) => ({
  SMTP_ENABLED: 'true',
  SMTP_HOST: 'mail.papamail.net',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'notify@openg7.org',
  SMTP_PASSWORD: 'smtp-test-password',
  SMTP_CONNECTION_TIMEOUT_MS: '10000',
  SMTP_GREETING_TIMEOUT_MS: '10000',
  SMTP_SOCKET_TIMEOUT_MS: '20000',
  MAIL_FROM_NAME: 'OpenG7',
  MAIL_FROM_ADDRESS: 'notify@openg7.org',
  MAIL_REPLY_TO_NAME: 'OpenG7',
  MAIL_REPLY_TO_ADDRESS: 'contact@openg7.org',
  ...overrides
});

const createSilentLogger = () => ({
  error() {},
  info() {}
});

test('SMTP config validates HostPapa defaults and creates the expected transport', async () => {
  const calls = [];
  const messages = [];
  const env = createEnabledEnv();
  const result = await emailModule.sendTransactionalEmail(
    {
      to: 'builder@example.com',
      subject: 'Hello',
      text: 'Text body'
    },
    {
      env,
      logger: createSilentLogger(),
      createTransport(options) {
        calls.push(options);
        return {
          async verify() {},
          async sendMail(message) {
            messages.push(message);
            return {
              messageId: 'smtp-message-1',
              accepted: message.to,
              rejected: []
            };
          }
        };
      }
    }
  );

  assert.equal(result.deliveryMode, 'smtp');
  assert.equal(result.messageId, 'smtp-message-1');
  assert.deepEqual(result.accepted, ['builder@example.com']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, 'mail.papamail.net');
  assert.equal(calls[0].port, 465);
  assert.equal(calls[0].secure, true);
  assert.deepEqual(calls[0].auth, {
    user: 'notify@openg7.org',
    pass: 'smtp-test-password'
  });
  assert.equal(calls[0].connectionTimeout, 10000);
  assert.equal(calls[0].greetingTimeout, 10000);
  assert.equal(calls[0].socketTimeout, 20000);
  assert.equal(messages[0].from, 'OpenG7 <notify@openg7.org>');
  assert.equal(messages[0].replyTo, 'OpenG7 <contact@openg7.org>');
});

test('SMTP disabled mode does not require a password and does not send', async () => {
  let transportCreated = false;
  const result = await emailModule.sendTransactionalEmail(
    {
      to: 'builder@example.com',
      subject: 'Disabled',
      text: 'No delivery'
    },
    {
      env: createEnabledEnv({
        SMTP_ENABLED: 'false',
        SMTP_PASSWORD: ''
      }),
      logger: createSilentLogger(),
      createTransport() {
        transportCreated = true;
        throw new Error('Transport must not be created.');
      }
    }
  );

  assert.equal(transportCreated, false);
  assert.equal(result.deliveryMode, 'disabled');
  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.rejected, ['builder@example.com']);
});

test('SMTP enabled mode rejects missing password without leaking secrets', () => {
  assert.throws(
    () =>
      emailModule.loadTransactionalEmailConfig(
        createEnabledEnv({ SMTP_PASSWORD: '' })
      ),
    (error) => {
      assert.equal(error.code, 'EMAIL_CONFIGURATION_ERROR');
      assert.equal(error.message.includes('smtp-test-password'), false);
      return true;
    }
  );
});

test('Transactional email supports text-only and text plus HTML messages', async () => {
  const messages = [];
  const createTransport = () => ({
    async verify() {},
    async sendMail(message) {
      messages.push(message);
      return {
        messageId: `message-${messages.length}`,
        accepted: message.to,
        rejected: []
      };
    }
  });

  await emailModule.sendTransactionalEmail(
    {
      to: 'text@example.com',
      subject: 'Text',
      text: 'Plain text'
    },
    {
      env: createEnabledEnv(),
      logger: createSilentLogger(),
      createTransport
    }
  );
  await emailModule.sendTransactionalEmail(
    {
      to: 'html@example.com',
      subject: 'HTML',
      text: 'Plain text',
      html: '<p>HTML</p>'
    },
    {
      env: createEnabledEnv(),
      logger: createSilentLogger(),
      createTransport
    }
  );

  assert.equal(Object.hasOwn(messages[0], 'html'), false);
  assert.equal(messages[1].html, '<p>HTML</p>');
});

test('Transactional email reports rejected recipients and authentication errors', async () => {
  const rejectedResult = await emailModule.sendTransactionalEmail(
    {
      to: 'rejected@example.com',
      subject: 'Rejected',
      text: 'Plain text'
    },
    {
      env: createEnabledEnv(),
      logger: createSilentLogger(),
      createTransport() {
        return {
          async verify() {},
          async sendMail() {
            return {
              messageId: 'smtp-message-2',
              accepted: [],
              rejected: ['rejected@example.com']
            };
          }
        };
      }
    }
  );

  assert.deepEqual(rejectedResult.accepted, []);
  assert.deepEqual(rejectedResult.rejected, ['rejected@example.com']);

  const logEntries = [];
  await assert.rejects(
    () =>
      emailModule.sendTransactionalEmail(
        {
          to: 'auth@example.com',
          subject: 'Auth',
          text: 'Plain text'
        },
        {
          env: createEnabledEnv(),
          logger: {
            error(...entry) {
              logEntries.push(entry);
            },
            info(...entry) {
              logEntries.push(entry);
            }
          },
          createTransport() {
            return {
              async verify() {},
              async sendMail() {
                const error = new Error(
                  'Provider text containing smtp-test-password'
                );
                error.code = 'EAUTH';
                throw error;
              }
            };
          }
        }
      ),
    (error) => {
      assert.equal(error.code, 'EMAIL_AUTHENTICATION_ERROR');
      assert.equal(error.message.includes('smtp-test-password'), false);
      return true;
    }
  );
  assert.equal(
    JSON.stringify(logEntries).includes('smtp-test-password'),
    false
  );
});

test('email:verify and email:test CLIs use injected transport and never send during verification', async () => {
  const stdout = [];
  const stderr = [];
  let verifyCalled = false;
  let sendCalled = false;
  const createTransport = () => ({
    async verify() {
      verifyCalled = true;
    },
    async sendMail(message) {
      sendCalled = true;
      return {
        messageId: 'smtp-cli-message',
        accepted: message.to,
        rejected: []
      };
    }
  });

  const verifyExitCode = await verifyCliModule.runEmailVerifyCli({
    env: createEnabledEnv(),
    createTransport,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message)
  });

  assert.equal(verifyExitCode, 0);
  assert.equal(verifyCalled, true);
  assert.equal(sendCalled, false);
  assert.equal(stderr.length, 0);
  assert.ok(stdout.includes('SMTP configuration loaded.'));
  assert.ok(
    stdout.includes(
      'SMTP connection verified successfully for notify@openg7.org.'
    )
  );

  const testExitCode = await testCliModule.runEmailTestCli({
    argv: ['--to=recipient@example.com'],
    env: createEnabledEnv(),
    createTransport,
    logger: createSilentLogger(),
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message)
  });

  assert.equal(testExitCode, 0);
  assert.equal(sendCalled, true);
  assert.ok(
    stdout.includes('SMTP test message sent to recipient@example.com.')
  );
  assert.ok(stdout.includes('messageId=smtp-cli-message'));
});
