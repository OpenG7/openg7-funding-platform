import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as tls from 'node:tls';
import { stripVTControlCharacters } from 'node:util';
import { redactStripeOutput, resolveStripeExecutable } from './stripe-cli.mjs';

export { redactStripeOutput };

export function stripeListenerEnvironment(env) {
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? ''))
    throw new Error('Le relais local exige STRIPE_SECRET_KEY en mode test.');
  if (!/^whsec_[A-Za-z0-9_]+$/.test(env.STRIPE_WEBHOOK_SECRET ?? ''))
    throw new Error(
      'Configurer STRIPE_WEBHOOK_SECRET dans .env avant de lancer le relais.'
    );
  if (env.STRIPE_API_HOST && env.STRIPE_API_HOST !== 'api.stripe.com')
    throw new Error(
      'Le simulateur Stripe utilise ses propres webhooks. Choisir --no-stripe-webhook.'
    );
  // Override a possibly unrelated CLI login or inherited API key without placing
  // credentials on the command line or changing the user's Stripe configuration.
  return { ...env, STRIPE_API_KEY: env.STRIPE_SECRET_KEY };
}

export function verifyStripeSigningSecret(output, expected) {
  if (output.trim() !== expected)
    throw new Error(
      'STRIPE_WEBHOOK_SECRET ne correspond pas au relais de ce compte test. Mettre a jour la configuration locale puis relancer; aucun secret affiche ni modifie.'
    );
}

export function stripeSnapshotListenerArgs(help) {
  const subscription = /^\s*--all-snapshot(?:\s|$)/m.test(help)
    ? ['--all-snapshot']
    : ['--events', '*'];
  return [
    'listen',
    ...subscription,
    '--forward-to',
    'https://localhost/api/stripe/webhook'
  ];
}

export function verifyLocalStripeTls({ connect = tls.connect } = {}) {
  return new Promise((resolveCheck, reject) => {
    const socket = connect({
      host: 'localhost',
      servername: 'localhost',
      port: 443,
      rejectUnauthorized: true,
      ...(tls.getCACertificates
        ? {
            ca: [
              ...tls.getCACertificates('default'),
              ...tls.getCACertificates('system')
            ]
          }
        : {})
    });
    const fail = () => {
      socket.destroy();
      reject(
        new Error(
          'HTTPS local indisponible ou non approuve. Verifier yarn tls:local:setup et la surcharge docker-compose.local-tls.yml avant les paiements de test.'
        )
      );
    };
    socket.setTimeout(10000, fail);
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      if (!socket.authorized) {
        fail();
        return;
      }
      socket.end();
      resolveCheck();
    });
  });
}

export function runStripeListener(
  args,
  {
    env,
    capture = false,
    executable = resolveStripeExecutable(env),
    onReady,
    readyTimeoutMs = 30000,
    stopTimeoutMs = 3000
  }
) {
  if (
    (onReady !== undefined && (typeof onReady !== 'function' || capture)) ||
    !Number.isFinite(readyTimeoutMs) ||
    readyTimeoutMs <= 0 ||
    !Number.isFinite(stopTimeoutMs) ||
    stopTimeoutMs <= 0
  )
    throw new Error('Invalid Stripe listener lifecycle options.');
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      env,
      stdio: [capture ? 'ignore' : 'inherit', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    });
    let output = '';
    let interrupted = false;
    let timedOut = false;
    let ready = false;
    let readyTimedOut = false;
    let readyCallbackFailed = false;
    let forceTimer;
    const stop = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        /* The process may already have exited. */
      }
      if (signal !== 'SIGKILL' && !forceTimer)
        forceTimer = setTimeout(() => stop('SIGKILL'), stopTimeoutMs);
    };
    const interrupt = () => {
      interrupted = true;
      stop('SIGINT');
    };
    const terminate = () => {
      interrupted = true;
      stop('SIGTERM');
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const timer = capture
      ? setTimeout(() => {
          timedOut = true;
          stop('SIGTERM');
        }, 20000)
      : null;
    const readyTimer = onReady
      ? setTimeout(() => {
          readyTimedOut = true;
          stop('SIGTERM');
        }, readyTimeoutMs)
      : null;
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.length > 65536) {
          timedOut = true;
          stop('SIGTERM');
        }
      });
      // Do not expose authentication diagnostics or the signing secret.
      child.stderr.resume();
    } else {
      for (const stream of [child.stdout, child.stderr]) {
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        lines.on('line', (line) => {
          const plain = stripVTControlCharacters(line);
          console.log(redactStripeOutput(plain));
          if (
            onReady &&
            !ready &&
            !readyTimedOut &&
            !interrupted &&
            /^(?:>\s*)?Ready!(?:\s|$)/.test(plain.trim())
          ) {
            ready = true;
            clearTimeout(readyTimer);
            try {
              onReady();
            } catch {
              readyCallbackFailed = true;
              stop('SIGTERM');
            }
          }
        });
      }
    }
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(readyTimer);
      clearTimeout(forceTimer);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    };
    child.once('error', () => {
      cleanup();
      reject(
        new Error(
          'Stripe CLI introuvable ou impossible a lancer. Installer avec yarn stripe:cli:install.'
        )
      );
    });
    child.once('close', (code) => {
      cleanup();
      if (interrupted) {
        const error = new Error(
          'Relais Stripe arrete. Les conteneurs Docker restent actifs.'
        );
        error.exitCode = 130;
        reject(error);
      } else if (readyTimedOut || readyCallbackFailed || (onReady && !ready))
        reject(new Error('Le relais Stripe ne confirme pas sa disponibilite.'));
      else if (timedOut || code !== 0)
        reject(
          new Error(
            'La commande Stripe a echoue. Verifier la CLI, la cle de test et la connexion reseau.'
          )
        );
      else resolveRun(output);
    });
  });
}
