// Acceptance assertions need the whole disposable mailbox, including after
// earlier scenarios have filled Mailpit's default first page.
export async function listCapturedMail(baseURL, fetchPage = fetch) {
  const messages = [];
  for (let page = 0; page < 100; page++) {
    const url = new URL('/api/v1/messages', baseURL);
    url.searchParams.set('start', String(messages.length));
    url.searchParams.set('limit', '50');
    const response = await fetchPage(url, {
      signal: AbortSignal.timeout(3000)
    });
    const body = await response.json();
    if (!response.ok) return { status: response.status, body };
    messages.push(...body.messages);
    if (messages.length >= body.total) {
      return {
        status: response.status,
        body: { ...body, start: 0, count: messages.length, messages }
      };
    }
    if (!body.messages.length)
      throw new Error('Mailpit pagination stopped before the reported total.');
  }
  throw new Error('Acceptance mailbox exceeds 5000 captured messages.');
}
