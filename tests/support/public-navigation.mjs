// Docker can change the host network while Chromium loads the public Web.
// Only this read-only public navigation may repeat, once, for that exact error.
export async function navigatePublicPageAfterNetworkChange(
  page,
  url,
  assertRendered,
  { navigation = 'goto' } = {}
) {
  const target = new URL(url);
  const funding = /^\/(?:en\/)?fonds-des-batisseurs$/.test(target.pathname);
  const transparency = /^\/(?:en\/)?fonds-des-batisseurs\/transparence$/.test(
    target.pathname
  );
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.search ||
    (!funding && !transparency) ||
    (target.hash && (!funding || target.hash !== '#support'))
  )
    throw new Error('Public navigation requires a loopback public page.');
  if (!['goto', 'reload'].includes(navigation))
    throw new Error('Public navigation requires goto or reload.');
  // Fragments identify a rendered section and are absent from HTTP requests.
  const documentTarget = new URL(target);
  documentTarget.hash = '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (navigation === 'reload' && page.url() !== target.href)
      throw new Error(
        'Public reload requires the page to remain at its target.'
      );
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
        (request.resourceType() === 'script' ||
          failed.href === documentTarget.href)
      )
        networkChanged = true;
    };
    page.on('requestfailed', onRequestFailed);
    try {
      const response =
        navigation === 'reload' ? await page.reload() : await page.goto(url);
      if (response?.status() !== 200) {
        unexpectedStatus = true;
        throw new Error('Public page did not return HTTP 200.');
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
