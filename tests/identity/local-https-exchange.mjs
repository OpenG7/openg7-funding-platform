import { request } from 'node:https';

/** Trusted loopback HTTPS with a deadline independent of socket activity. */
export function createLocalHttpsExchange({
  port,
  origin,
  issuer,
  ca,
  timeout = 10_000
}) {
  return (
    path,
    { cookie, provider = false, method = 'GET', headers = {}, body } = {}
  ) =>
    new Promise((resolve, reject) => {
      let pending;
      let response;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (error) {
          response?.destroy();
          pending?.destroy();
          reject(error);
        } else resolve(result);
      };
      const deadline = setTimeout(
        () => finish(new Error('Local HTTPS request timed out.')),
        timeout
      );
      const interrupted = () =>
        finish(new Error('Local HTTPS response was interrupted.'));
      try {
        const url = new URL(path, provider ? issuer : origin);
        pending = request(
          {
            hostname: '127.0.0.1',
            port,
            servername: url.hostname,
            path: url.pathname + url.search,
            method,
            ca,
            agent: false,
            headers: {
              ...headers,
              Host: url.host,
              ...(cookie ? { Cookie: cookie } : {})
            }
          },
          (incoming) => {
            response = incoming;
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.once('aborted', interrupted);
            response.once('error', interrupted);
            response.once('close', () => {
              if (!response.complete) interrupted();
            });
            response.once('end', () => {
              if (!response.complete) return interrupted();
              finish(null, {
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8')
              });
            });
          }
        );
        pending.once('error', () =>
          finish(new Error('Trusted local HTTPS request failed.'))
        );
        pending.end(body);
      } catch {
        finish(new Error('Trusted local HTTPS request failed.'));
      }
    });
}
