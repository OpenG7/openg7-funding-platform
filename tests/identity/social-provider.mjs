import { once } from 'node:events';
import { createServer } from 'node:http';

// Local protocol fixture: no provider credentials or external network requests.
export async function startSocialProvider() {
  const accounts = new Map();
  const requests = [];
  const posts = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const channel = url.pathname.split('/')[1];
    const account = accounts.get(
      req.headers.authorization?.replace(/^Bearer /, '')
    );
    const checking = req.method === 'GET';
    const finish = (status, body = {}, postId) => {
      requests.push({
        channel,
        phase: checking ? 'check' : 'send',
        accountId: account?.id ?? null,
        status
      });
      res.writeHead(status, {
        'Content-Type': 'application/json',
        ...(postId ? { 'x-restli-id': postId } : {})
      });
      res.end(JSON.stringify(body));
    };
    if (!account || account.channel !== channel) return finish(401);
    if (checking) {
      if (account.checkStatus !== 200) return finish(account.checkStatus);
      if (url.pathname === '/facebook/me')
        return finish(200, { id: account.checkedId ?? account.id });
      if (url.pathname === '/linkedin/organizationAcls')
        return finish(200, {
          elements: [
            {
              organization:
                'urn:li:organization:' + (account.checkedId ?? account.id),
              role: 'ADMINISTRATOR'
            }
          ]
        });
      return finish(404);
    }
    if (req.method !== 'POST') return finish(405);
    if (account.sendStatus !== 200) return finish(account.sendStatus);
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16384) return finish(413);
      }
      let message;
      if (
        channel === 'facebook' &&
        url.pathname === `/facebook/${account.id}/feed`
      ) {
        message = new URLSearchParams(body).get('message');
      } else if (channel === 'linkedin' && url.pathname === '/linkedin/posts') {
        const input = JSON.parse(body);
        if (input.author !== 'urn:li:organization:' + account.id)
          return finish(403);
        message = input.commentary;
      } else return finish(404);
      if (typeof message !== 'string' || !message) return finish(400);
      const id =
        channel === 'facebook'
          ? `${account.id}_${posts.length + 1000}`
          : `urn:li:share:${posts.length + 1000}`;
      posts.push({ id, channel, accountId: account.id, message });
      // No deduplication: a second request would create a second visible post.
      finish(
        201,
        channel === 'facebook' ? { id } : {},
        channel === 'linkedin' ? id : undefined
      );
    } catch {
      finish(400);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    posts,
    account(token, options) {
      if (!token.startsWith('synthetic-'))
        throw new Error('Synthetic credentials required.');
      accounts.set(token, { checkStatus: 200, sendStatus: 200, ...options });
    },
    async stop() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
  };
}

export function socialFixtureEnvironment(social) {
  const url = new URL(social.origin);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Social fixture must use a local receiver.');
  const env = {
    // Exercise both HTTP adapters against this fixture, never a real provider.
    SOCIAL_PUBLICATION_MODE: 'live',
    SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL: url.origin + '/facebook',
    SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL: url.origin + '/linkedin'
  };
  for (const target of ['openg7', 'openg20'])
    for (const channel of ['facebook', 'linkedin']) {
      const value = social.accounts[`${target}:${channel}`];
      if (
        value &&
        (!/^\d+$/.test(value.accountId) ||
          !value.accessToken.startsWith('synthetic-'))
      )
        throw new Error('Synthetic social account required.');
      const prefix = `SOCIAL_PUBLICATION_${target.toUpperCase()}_${channel.toUpperCase()}`;
      env[prefix + '_ACCOUNT_ID'] = value?.accountId ?? '';
      env[prefix + '_ACCESS_TOKEN'] = value?.accessToken ?? '';
      env[prefix + '_EXPIRES_AT'] = value?.expiresAt ?? '';
    }
  return env;
}
