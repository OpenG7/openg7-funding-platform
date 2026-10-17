const recoveryAdminTarget = (url) => {
  const target = new URL(url);
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname) ||
    target.username ||
    target.password ||
    ![
      '/admin/fundraiser/contributions',
      '/admin/fundraiser/invoices',
      '/admin/fundraiser/email-queue'
    ].includes(target.pathname) ||
    target.search ||
    target.hash
  )
    throw new Error(
      'Recovery admin navigation requires an exact loopback read-only page.'
    );
  return target;
};

const savedSession = (page) =>
  page.evaluate(() => ({
    token: sessionStorage.getItem('openg7-admin-session-token'),
    expiresAt: sessionStorage.getItem('openg7-admin-session-expires-at')
  }));

const validSession = (session) =>
  typeof session?.token === 'string' &&
  session.token.startsWith('openg7-admin-session.') &&
  Date.parse(session.expiresAt) > Date.now();

// Docker network changes can interrupt a lazy admin chunk after HTTP 200.
// Repeat only this read-only page load once, under the same confirmed session.
export async function navigateRecoveryAdminAfterNetworkChange(
  page,
  url,
  assertRendered
) {
  const target = recoveryAdminTarget(url);
  if (new URL(page.url()).origin !== target.origin)
    throw new Error(
      'Recovery admin navigation requires the current loopback origin.'
    );
  const session = await savedSession(page);
  if (!validSession(session))
    throw new Error(
      'Recovery admin navigation requires an unexpired saved session.'
    );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let networkChanged = false;
    let documentReady = false;
    let responseFailed = false;
    const onRequestFailed = (request) => {
      if (
        request.failure()?.errorText !== 'net::ERR_NETWORK_CHANGED' ||
        request.method() !== 'GET' ||
        request.resourceType() !== 'script'
      )
        return;
      const failed = new URL(request.url());
      if (
        failed.origin === target.origin &&
        /^\/chunk-[a-z0-9]+\.js$/i.test(failed.pathname) &&
        !failed.search
      )
        networkChanged = true;
    };
    const onResponse = (response) => {
      const resource = new URL(response.url());
      if (
        resource.origin === target.origin &&
        (response.status() === 401 ||
          response.status() === 403 ||
          (response.status() >= 400 &&
            (resource.pathname.startsWith('/api/admin/') ||
              ['script', 'document'].includes(
                response.request().resourceType()
              ))))
      )
        responseFailed = true;
    };
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    try {
      const response = await page.goto(url);
      if (response?.status() !== 200) {
        responseFailed = true;
        throw new Error('Recovery admin page did not return HTTP 200.');
      }
      documentReady = true;
      await assertRendered();
      return response;
    } catch (error) {
      if (
        attempt === 1 ||
        !documentReady ||
        responseFailed ||
        !networkChanged ||
        page.url() !== target.href
      )
        throw error;
      let current;
      try {
        current = await savedSession(page);
      } catch {
        throw error;
      }
      if (
        !validSession(current) ||
        current.token !== session.token ||
        current.expiresAt !== session.expiresAt
      )
        throw error;
    } finally {
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    }
  }
}
