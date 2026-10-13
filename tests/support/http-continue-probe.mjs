import { request as httpRequest } from 'node:http';

/** Send a fixture body only after the server accepts its declared length. */
export function probeHttpWithContinue(
  url,
  { body, headers = {}, timeoutMs = 5000 }
) {
  return new Promise((resolveResponse, reject) => {
    let finalResponseReceived = false;
    const request = httpRequest(
      url,
      {
        method: 'POST',
        agent: false,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
          Expect: '100-continue'
        }
      },
      (response) => {
        finalResponseReceived = true;
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('aborted', () =>
          reject(new Error('Fixture response aborted before completion'))
        );
        response.on('end', () => {
          if (!response.complete) {
            reject(new Error('Fixture response is incomplete'));
            return;
          }
          request.setTimeout(0);
          resolveResponse({
            status: response.statusCode,
            json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8'))
          });
          request.destroy();
        });
      }
    );
    request.on('error', reject);
    request.once('continue', () => {
      if (!finalResponseReceived) request.end(body);
    });
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error('Fixture request timeout'))
    );
    request.flushHeaders();
  });
}
