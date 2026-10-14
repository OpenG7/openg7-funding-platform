import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request as proxyRequest } from 'node:http';

/** Existing Stripe HTTP simulator, isolated per OIDC journey and bound to loopback. */
export async function startIdentityStripeProvider() {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import http from 'node:http';
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(_port, callback) {
      return listen.call(this, 0, '127.0.0.1', () => {
        console.log('TEST_STRIPE_PORT=' + this.address().port); callback?.();
      });
    };
    await import('./tests/stripe-stub/server.mjs');
  `
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PORT: '0'
      }
    }
  );
  const stopChild = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit');
      child.kill();
      await done;
    }
  };
  let proxy;
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Local Stripe simulator did not start')),
        15000
      );
      let output = '';
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('Local Stripe simulator exited'));
      };
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.on('data', (bytes) => {
        output = (output + bytes).slice(-4096);
        const match = /TEST_STRIPE_PORT=(\d+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    let accountId = 'acct_identity_fixture';
    proxy = createServer((req, res) => {
      if (req.url === '/v1/account') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: accountId, object: 'account' }));
        return;
      }
      const upstream = proxyRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: req.url,
          method: req.method,
          headers: req.headers
        },
        (answer) => {
          res.writeHead(answer.statusCode, answer.headers);
          answer.pipe(res);
        }
      );
      upstream.on('error', () => res.writeHead(503).end());
      req.pipe(upstream);
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    return {
      origin: `http://127.0.0.1:${proxy.address().port}`,
      webhookSecret: 'whsec_identity_stripe_fixture',
      setAccount(id) {
        if (!/^acct_[A-Za-z0-9_]+$/.test(id))
          throw new Error('Invalid synthetic account');
        accountId = id;
      },
      async stop() {
        await new Promise((resolve) => {
          proxy.close(resolve);
          proxy.closeAllConnections();
        });
        await stopChild();
      }
    };
  } catch (error) {
    if (proxy?.listening)
      await new Promise((resolve) => {
        proxy.close(resolve);
        proxy.closeAllConnections();
      });
    await stopChild();
    throw error;
  }
}
