// Interactive, loopback-only identity provider. Signing keys exist only in memory.
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign
} from 'node:crypto';

export async function startIdentityProvider(origin) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'identity-acceptance',
    alg: 'RS256',
    use: 'sig'
  };
  const pending = new Map(),
    grants = new Map();
  let issuer,
    tokenAvailable = true;
  const clientId = 'identity-acceptance';
  const clientSecret = randomBytes(24).toString('hex');
  const subjects = [
    'owner',
    'operator',
    'reader',
    'unknown',
    'no-mfa',
    'bad-signature'
  ];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, issuer);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/token' && !tokenAvailable)
        return res.writeHead(503).end('{}');
      if (url.pathname === '/.well-known/openid-configuration')
        return res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported: ['S256']
          })
        );
      if (url.pathname === '/jwks')
        return res.end(JSON.stringify({ keys: [jwk] }));
      if (url.pathname === '/authorize') {
        if (
          url.searchParams.get('client_id') !== clientId ||
          url.searchParams.get('redirect_uri') !==
            `${origin}/api/admin/auth/callback` ||
          url.searchParams.get('code_challenge_method') !== 'S256'
        )
          return res.writeHead(400).end('{}');
        const ticket = randomBytes(16).toString('hex');
        pending.set(ticket, Object.fromEntries(url.searchParams));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(`<!doctype html><html lang="fr"><title>Identité simulée</title><h1>Identité simulée</h1>
          <form action="/approve" method="post"><input type="hidden" name="ticket" value="${ticket}">
          <label>Compte de test <select name="subject">${subjects.map((s) => `<option>${s}</option>`).join('')}</select></label>
          <button>Continuer</button></form></html>`);
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) return res.writeHead(413).end('{}');
      }
      const params = new URLSearchParams(body);
      if (url.pathname === '/approve' && req.method === 'POST') {
        const grant = pending.get(params.get('ticket'));
        pending.delete(params.get('ticket'));
        const subject = params.get('subject');
        if (!grant || !subjects.includes(subject))
          return res.writeHead(400).end('{}');
        const code = randomBytes(16).toString('hex');
        grants.set(code, { ...grant, subject });
        const callback = new URL(grant.redirect_uri);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', grant.state);
        return res.writeHead(303, { Location: callback.href }).end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const grant = grants.get(params.get('code'));
        grants.delete(params.get('code'));
        const basic =
          'Basic ' +
          Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const clientValid =
          req.headers.authorization === basic ||
          (params.get('client_id') === clientId &&
            params.get('client_secret') === clientSecret);
        if (
          !clientValid ||
          !grant ||
          params.get('grant_type') !== 'authorization_code' ||
          params.get('redirect_uri') !== grant.redirect_uri ||
          createHash('sha256')
            .update(params.get('code_verifier') ?? '')
            .digest('base64url') !== grant.code_challenge
        )
          return res.writeHead(400).end('{}');
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(
          JSON.stringify({ alg: 'RS256', kid: jwk.kid })
        ).toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({
            iss: issuer,
            sub: `fixture-${grant.subject}`,
            aud: clientId,
            iat: now,
            exp: now + 120,
            nonce: grant.nonce,
            amr: grant.subject === 'no-mfa' ? ['pwd'] : ['pwd', 'mfa'],
            name: `Fixture ${grant.subject}`
          })
        ).toString('base64url');
        const data = `${header}.${payload}`;
        const signature =
          grant.subject === 'bad-signature'
            ? randomBytes(256)
            : sign('RSA-SHA256', Buffer.from(data), privateKey);
        return res.end(
          JSON.stringify({
            token_type: 'Bearer',
            access_token: 'synthetic-unused',
            expires_in: 120,
            id_token: `${data}.${signature.toString('base64url')}`
          })
        );
      }
      res.writeHead(404).end('{}');
    } catch {
      res.writeHead(500).end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  issuer = `http://127.0.0.1:${server.address().port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    setTokenAvailable(value) {
      tokenAvailable = value;
    },
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeAllConnections();
      })
  };
}
