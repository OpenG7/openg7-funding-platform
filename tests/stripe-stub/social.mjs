// Isolated provider simulator, never mounted by the application API.
// Every received send is counted; duplicate requests are deliberately NOT deduplicated.
const prefix = '/__test__/social';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const feed = /^(openg7|openg20):(facebook|linkedin)$/;
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c]
  );

export function socialSimulator() {
  const faults = new Map();
  const posts = new Map();
  const requests = [];
  const json = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const body = async (request) => {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16384) throw new Error('Body too large.');
    }
    return JSON.parse(raw);
  };
  return async (request, response, url) => {
    if (!url.pathname.startsWith(prefix + '/')) return false;
    const path = url.pathname.slice(prefix.length);
    try {
      if (request.method === 'GET' && path.startsWith('/accounts/')) {
        const id = decodeURIComponent(path.slice('/accounts/'.length));
        json(
          response,
          feed.test(id.slice(5)) && id.startsWith('mock-') ? 200 : 404,
          { id }
        );
      } else if (request.method === 'POST' && path === '/faults') {
        const value = await body(request);
        if (
          !uuid.test(value.deliveryId) ||
          !['accepted-response-lost', 'absent-response-lost'].includes(
            value.fault
          )
        )
          json(response, 400, { error: 'Invalid fault.' });
        else if (requests.some((r) => r.deliveryId === value.deliveryId))
          json(response, 409, { error: 'The delivery already started.' });
        else {
          faults.set(value.deliveryId, value.fault);
          json(response, 200, { configured: true });
        }
      } else if (request.method === 'POST' && path === '/deliveries') {
        const value = await body(request);
        if (
          !uuid.test(value.deliveryId) ||
          !feed.test(value.feedId) ||
          value.accountId !== `mock-${value.feedId}` ||
          typeof value.message !== 'string' ||
          !value.message.trim() ||
          value.message.length > 2900 ||
          !(value.mediaId === null || typeof value.mediaId === 'string')
        ) {
          json(response, 400, { error: 'Invalid publication.' });
          return true;
        }
        const fault = faults.get(value.deliveryId);
        faults.delete(value.deliveryId);
        const prior = [...posts.values()].filter(
          (p) => p.deliveryId === value.deliveryId
        ).length;
        const id = `mock-${value.deliveryId}${prior ? '-' + (prior + 1) : ''}`;
        const accepted = fault !== 'absent-response-lost';
        const receivedAt = new Date().toISOString();
        requests.push({
          deliveryId: value.deliveryId,
          feedId: value.feedId,
          accepted,
          postId: accepted ? id : null,
          receivedAt,
          outcome: fault ?? 'acknowledged'
        });
        if (accepted)
          posts.set(id, {
            id,
            deliveryId: value.deliveryId,
            feedId: value.feedId,
            accountId: value.accountId,
            message: value.message,
            mediaId: value.mediaId,
            mediaSha256: value.mediaSha256 ?? null,
            isPublished: true,
            publishedAt: receivedAt
          });
        if (fault)
          response.destroy(); // The outcome persists on the provider before the socket is lost.
        else json(response, 200, { id });
      } else if (request.method === 'GET' && path.startsWith('/posts/')) {
        const post = posts.get(
          decodeURIComponent(path.slice('/posts/'.length))
        );
        json(response, post ? 200 : 404, post ?? { error: 'Post not found.' });
      } else if (
        request.method === 'GET' &&
        ['/receipts', '/inspect'].includes(path)
      ) {
        const id = url.searchParams.get('deliveryId');
        if (!id || !uuid.test(id)) {
          json(response, 400, { error: 'A delivery ID is required.' });
          return true;
        }
        const found = [...posts.values()].filter((p) => p.deliveryId === id);
        if (path === '/receipts')
          json(response, 200, {
            requests: requests.filter((r) => r.deliveryId === id),
            posts: found
          });
        else {
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'none'; style-src 'unsafe-inline'"
          });
          response.end(
            `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Réseau social simulé</title><style>body{font:18px system-ui;max-width:800px;margin:40px auto;padding:20px}article{border:1px solid;padding:20px;margin:20px 0}code{overflow-wrap:anywhere}</style><h1>Réseau social simulé</h1><p>Inspection locale, aucun envoi vers un réseau réel.</p>${found.length ? found.map((p) => `<article><h2>${escapeHtml(p.feedId)}</h2><p>${escapeHtml(p.message)}</p><p>Identifiant : <code>${escapeHtml(p.id)}</code></p></article>`).join('') : '<p>Aucune publication trouvée pour cet envoi.</p>'}</html>`
          );
        }
      } else json(response, 404, { error: 'Unknown simulation endpoint.' });
    } catch {
      if (!response.headersSent && !response.destroyed)
        json(response, 400, { error: 'Invalid simulation request.' });
    }
    return true;
  };
}
