// Docker network creation can interrupt Chromium's first application script.
// Repeat only this read-only login-page load, before entering any credentials.
export async function navigateRecoveryLoginAfterNetworkChange(
  page,
  url,
  assertRendered
) {
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
