import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

if (
  process.env.OPENG7_E2E_ISOLATED !== '1' ||
  !/^og7-acceptance-[a-f0-9-]+$/.test(process.env.COMPOSE_PROJECT_NAME ?? '')
) {
  throw new Error('Disposable Preflight acceptance identity required.');
}
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = {
  ...(await exportJWK(publicKey)),
  kid: 'synthetic-acceptance-key',
  alg: 'RS256'
};
const issuer = 'http://127.0.0.1:3401';
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.method === 'GET' && request.url === '/health') {
    response.end('{"status":"ok","synthetic":true}');
    return;
  }
  if (request.method === 'GET' && request.url === '/keys') {
    response.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/token') {
    response.writeHead(404).end('{}');
    return;
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16384) {
      response.writeHead(413).end('{}');
      return;
    }
  }
  const form = new URLSearchParams(body);
  if (
    form.get('grant_type') !== 'client_credentials' ||
    form.get('client_id') !== 'synthetic-funding-acceptance' ||
    form.get('client_secret') !== 'synthetic-acceptance-only-secret'
  ) {
    response.writeHead(401).end('{}');
    return;
  }
  const token = await new SignJWT({
    tenant_id: 'synthetic-preflight-acceptance',
    applications: ['funding-platform'],
    realm_access: { roles: ['service_integration'] }
  })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setSubject('synthetic-funding-acceptance')
    .setIssuer(issuer)
    .setAudience('preflight-api')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  response.end(
    JSON.stringify({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 300
    })
  );
});
server.listen(3401, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close());
