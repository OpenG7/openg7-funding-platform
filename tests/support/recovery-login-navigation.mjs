const recoveryLoginTarget = (url) => {
  const target = new URL(url);
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.pathname !== '/admin/login' ||
    target.search ||
    target.hash
  )
    throw new Error('Recovery login requires the exact loopback login page.');
  return target;
};

// Docker network creation can interrupt Chromium's first application script.
// Repeat only this read-only login-page load, before entering any credentials.
export async function navigateRecoveryLoginAfterNetworkChange(
  page,
  url,
  assertRendered
) {
  const target = recoveryLoginTarget(url);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let networkChanged = false;
    let unexpectedStatus = false;
    const onRequestFailed = (request) => {
      if (
        request.failure()?.errorText !== 'net::ERR_NETWORK_CHANGED' ||
        request.method() !== 'GET' ||
        !['script', 'document'].includes(request.resourceType())
      )
        return;
      const failed = new URL(request.url());
      if (
        failed.origin === target.origin &&
        !failed.pathname.startsWith('/api/') &&
        (request.resourceType() === 'script' || failed.href === target.href)
      )
        networkChanged = true;
    };
    page.on('requestfailed', onRequestFailed);
    try {
      const response = await page.goto(url);
      if (response?.status() !== 200) {
        unexpectedStatus = true;
        throw new Error('Recovery login page did not return HTTP 200.');
      }
      await assertRendered();
      return response;
    } catch (error) {
      if (attempt === 1 || unexpectedStatus || !networkChanged) throw error;
    } finally {
      page.off('requestfailed', onRequestFailed);
    }
  }
}

// A confirmed session can outlive an interrupted lazy admin-route import.
// Reconcile that exact session before one read-only navigation; never resubmit.
export async function completeRecoveryLoginAfterNetworkChange(
  page,
  url,
  submit,
  assertSignedIn
) {
  const target = recoveryLoginTarget(url);
  let networkChanged = false;
  let sessionResponse;
  const onResponse = (response) => {
    if (
      response.url() === target.origin + '/api/admin/session' &&
      response.request().method() === 'POST' &&
      response.status() === 200
    )
      sessionResponse = response;
  };
  const onRequestFailed = (request) => {
    if (
      request.failure()?.errorText !== 'net::ERR_NETWORK_CHANGED' ||
      request.method() !== 'GET' ||
      request.resourceType() !== 'script'
    )
      return;
    const failed = new URL(request.url());
    if (failed.origin === target.origin && !failed.pathname.startsWith('/api/'))
      networkChanged = true;
  };
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  try {
    await submit();
    try {
      await assertSignedIn();
      return;
    } catch (error) {
      if (!networkChanged || !sessionResponse) throw error;
      let savedSessionMatches = false;
      try {
        const session = await sessionResponse.json();
        savedSessionMatches = await page.evaluate((expected) => {
          const token = sessionStorage.getItem('openg7-admin-session-token');
          const expiresAt = sessionStorage.getItem(
            'openg7-admin-session-expires-at'
          );
          return (
            typeof expected.sessionToken === 'string' &&
            expected.sessionToken.startsWith('openg7-admin-session.') &&
            token === expected.sessionToken &&
            expiresAt === expected.expiresAt &&
            Date.parse(expiresAt) > Date.now()
          );
        }, session);
      } catch {
        // A missing or uncertain session cannot authorize another sign-in.
      }
      if (!savedSessionMatches) throw error;
      const response = await page.goto(target.origin + '/admin/fundraiser');
      if (response?.status() !== 200)
        throw new Error('Recovery admin page did not return HTTP 200.');
      await assertSignedIn();
    }
  } finally {
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  }
}
