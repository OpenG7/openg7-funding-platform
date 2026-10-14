// Docker can change the host network while Chromium loads the restored Web.
// Only this read-only public navigation may repeat, once, for that exact error.
export async function navigateRecoveryPublicPage(page, url, assertRendered) {
  const target = new URL(url);
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !/^\/(?:en\/)?fonds-des-batisseurs\/transparence$/.test(target.pathname)
  )
    throw new Error('Recovery navigation requires a loopback public page.');

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
        throw new Error('Recovery public page did not return HTTP 200.');
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
