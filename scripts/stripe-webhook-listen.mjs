#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/load-dotenv.mjs';
import {
  runStripeListener,
  stripeListenerEnvironment,
  stripeSnapshotListenerArgs,
  verifyLocalStripeTls,
  verifyStripeSigningSecret
} from './lib/stripe-listener.mjs';

// A managed relay must not survive its gateway. Emitting the registered handler
// also works on Windows, where sending SIGTERM to ourselves kills Node outright.
let disconnectHandled = false;
const parentDisconnected = () => {
  if (disconnectHandled) return;
  disconnectHandled = true;
  if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM');
  else process.exit(130);
};
if (typeof process.send === 'function')
  process.once('disconnect', parentDisconnected);

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--help'].includes(arg)))
    throw new Error(
      'Options autorisees : --check, --help. Ce relais est reserve au test local.'
    );
  if (args.includes('--help')) {
    console.log(`Usage: yarn stripe:webhook:listen [--check]
Lit .env (le shell prime), utilise sa cle Stripe de test et verifie le secret
de signature sans l'afficher. --check verifie sans relayer d'evenement.
Transmet vers https://localhost/api/stripe/webhook avec verification TLS.
Prerequis HTTPS local : yarn tls:local:setup.
Garder ce terminal ouvert; Ctrl+C arrete uniquement le relais.`);
  } else {
    process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    loadDotEnv('.env');
    const env = stripeListenerEnvironment(process.env);
    const listenerArgs = stripeSnapshotListenerArgs(
      await runStripeListener(['listen', '--help'], { env, capture: true })
    );
    const secret = await runStripeListener(['listen', '--print-secret'], {
      env,
      capture: true
    });
    verifyStripeSigningSecret(secret, env.STRIPE_WEBHOOK_SECRET);
    console.log('Stripe test : cle et secret de signature coherents.');
    if (!args.includes('--check')) {
      await verifyLocalStripeTls();
      console.log(
        'Relais Stripe vers https://localhost/api/stripe/webhook. Garder ce terminal ouvert (Ctrl+C pour arreter).'
      );
      await runStripeListener(listenerArgs, {
        env,
        ...(typeof process.send === 'function'
          ? {
              onReady: () =>
                process.send({ type: 'stripe-ready' }, (error) => {
                  if (error) parentDisconnected();
                })
            }
          : {})
      });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode ?? 1;
} finally {
  process.off('disconnect', parentDisconnected);
  if (process.connected) process.disconnect();
}
