import type { PublicationDelivery } from '@openg7/funding-core';

import type {
  SocialPublicationConfig,
  SocialPublicationProviderResult
} from '../social-publication.service.js';

import { PublicationAutomationError, assert, digest } from './policy.js';

export class DeliveryFailure extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'rejected' | 'retry' | 'uncertain'
  ) {
    super(code);
  }
}
type Json = Record<string, unknown>;
const object = (v: unknown): Json =>
  v && typeof v === 'object' ? (v as Json) : {};
const string = (v: unknown): string => (typeof v === 'string' ? v : '');
const headers = (c: SocialPublicationConfig) => ({
  Authorization: `Bearer ${c.linkedin.accessToken}`,
  'Linkedin-Version': c.linkedin.version,
  'X-Restli-Protocol-Version': '2.0.0'
});
const author = (id: string) =>
  id.startsWith('urn:li:organization:') ? id : `urn:li:organization:${id}`;

async function call(
  url: string,
  init: RequestInit,
  publishing = false
): Promise<{ response: Response; data: Json }> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(20000)
    });
    let data: Json = {};
    try {
      data = object(JSON.parse(await response.text()));
    } catch {
      /* A successful empty response may use an id header. */
    }
    if (!response.ok)
      throw new DeliveryFailure(
        `PROVIDER_HTTP_${response.status}`,
        response.status === 429
          ? 'retry'
          : response.status >= 500 || response.status === 408
            ? publishing
              ? 'uncertain'
              : 'retry'
            : 'rejected'
      );
    return { response, data };
  } catch (error) {
    if (error instanceof DeliveryFailure) throw error;
    throw new DeliveryFailure(
      'PROVIDER_UNREACHABLE',
      publishing ? 'uncertain' : 'retry'
    );
  }
}
export async function checkConnection(
  c: SocialPublicationConfig,
  channel: string,
  accountId: string
): Promise<void> {
  assert(c.mode !== 'disabled', 'DISABLED');
  if (c.mode === 'mock') {
    if (c.mockBaseUrl) {
      const { data } = await call(
        `${c.mockBaseUrl}/accounts/${encodeURIComponent(accountId)}`,
        {}
      );
      assert(data.id === accountId, 'ACCOUNT_MISMATCH');
    }
    return;
  }
  if (channel === 'facebook') {
    const { data } = await call(`${c.facebook.graphBaseUrl}/me?fields=id`, {
      headers: { Authorization: `Bearer ${c.facebook.pageAccessToken}` }
    });
    assert(string(data.id) === accountId, 'ACCOUNT_MISMATCH');
  } else {
    const { data } = await call(
      `${c.linkedin.apiBaseUrl}/organizationAcls?q=roleAssignee&state=APPROVED`,
      { headers: headers(c) }
    );
    const entries = Array.isArray(data.elements)
      ? data.elements.map(object)
      : [];
    assert(
      entries.some(
        (e) =>
          e.organization === author(accountId) &&
          ['ADMINISTRATOR', 'CONTENT_ADMIN'].includes(string(e.role))
      ),
      'ACCOUNT_PERMISSION'
    );
  }
}
export async function sendDelivery(
  c: SocialPublicationConfig,
  job: PublicationDelivery,
  media: Buffer | null,
  cachedImage: string | null = null,
  persistImage: (id: string) => Promise<void> = async () => {}
): Promise<SocialPublicationProviderResult> {
  assert(c.mode !== 'disabled' && c.mode === job.mode, 'MODE_CHANGED');
  if (c.mode === 'mock') {
    if (c.mockBaseUrl) {
      const { data } = await call(
        `${c.mockBaseUrl}/deliveries`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliveryId: job.id,
            feedId: job.feedId,
            accountId: job.accountId,
            message: job.message,
            mediaId: job.mediaId,
            mediaSha256: media ? digest(media) : null
          })
        },
        true
      );
      if (data.id !== `mock-${job.id}`)
        throw new DeliveryFailure('PROVIDER_MISSING_ID', 'uncertain');
    }
    return {
      externalPostId: `mock-${job.id}`,
      externalPostUrl: `https://social.openg7.local/${job.feedId}/${job.id}`
    };
  }
  if (job.feedId.endsWith(':facebook')) {
    let body: URLSearchParams | FormData;
    if (media) {
      body = new FormData();
      body.set(
        'source',
        new Blob([new Uint8Array(media)], { type: 'image/jpeg' }),
        'publication.jpg'
      );
      body.set('caption', job.message);
      body.set('alt_text_custom', job.mediaAlt || '');
    } else body = new URLSearchParams({ message: job.message });
    const { data } = await call(
      `${c.facebook.graphBaseUrl}/${encodeURIComponent(job.accountId)}/${media ? 'photos' : 'feed'}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.facebook.pageAccessToken}` },
        body
      },
      true
    );
    const id = string(media ? data.post_id : data.id);
    if (!id) throw new DeliveryFailure('PROVIDER_MISSING_ID', 'uncertain');
    return {
      externalPostId: id,
      externalPostUrl: `https://www.facebook.com/${encodeURIComponent(id)}`
    };
  }
  let imageId: string | null = cachedImage;
  if (media && !imageId) {
    const { data } = await call(
      `${c.linkedin.apiBaseUrl}/images?action=initializeUpload`,
      {
        method: 'POST',
        headers: { ...headers(c), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initializeUploadRequest: { owner: author(job.accountId) }
        })
      }
    );
    const value = object(data.value);
    imageId = string(value.image);
    const upload = new URL(string(value.uploadUrl));
    assert(
      upload.protocol === 'https:' &&
        upload.hostname === 'www.linkedin.com' &&
        upload.pathname.startsWith('/dms-uploads/') &&
        imageId.startsWith('urn:li:image:'),
      'INVALID_UPLOAD'
    );
    await call(upload.href, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${c.linkedin.accessToken}`,
        'Content-Type': 'image/jpeg'
      },
      body: new Uint8Array(media)
    });
    await persistImage(imageId);
  }
  if (imageId) {
    // No public post exists at this point. A not-yet-available upload is safe to retry.
    const { data: image } = await call(
      `${c.linkedin.apiBaseUrl}/images/${encodeURIComponent(imageId)}`,
      { headers: headers(c) }
    );
    if (image.status !== 'AVAILABLE')
      throw new DeliveryFailure(
        'MEDIA_PROCESSING',
        image.status === 'PROCESSING_FAILED' ? 'rejected' : 'retry'
      );
  }
  const { response, data } = await call(
    `${c.linkedin.apiBaseUrl}/posts`,
    {
      method: 'POST',
      headers: { ...headers(c), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: author(job.accountId),
        commentary: job.message,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        lifecycleState: 'PUBLISHED',
        ...(imageId
          ? { content: { media: { id: imageId, altText: job.mediaAlt || '' } } }
          : {})
      })
    },
    true
  );
  const id = response.headers.get('x-restli-id') || string(data.id);
  if (!/^urn:li:(share|ugcPost):\d+$/.test(id))
    throw new DeliveryFailure('PROVIDER_MISSING_ID', 'uncertain');
  return {
    externalPostId: id,
    externalPostUrl: `https://www.linkedin.com/feed/update/${id}/`
  };
}
export async function verifyRemote(
  c: SocialPublicationConfig,
  job: PublicationDelivery,
  id: string
): Promise<SocialPublicationProviderResult> {
  assert(c.mode === job.mode, 'MODE_CHANGED');
  if (c.mode === 'mock') {
    if (c.mockBaseUrl) {
      assert(!job.mediaId, 'MEDIA_RECONCILIATION_REQUIRED');
      const { data } = await call(
        `${c.mockBaseUrl}/posts/${encodeURIComponent(id)}`,
        {}
      );
      assert(
        data.id === id &&
          data.deliveryId === job.id &&
          data.accountId === job.accountId &&
          data.feedId === job.feedId &&
          data.message === job.message &&
          data.isPublished === true &&
          !data.mediaId,
        'POST_MISMATCH'
      );
    } else assert(id === `mock-${job.id}`, 'POST_MISMATCH');
    return {
      externalPostId: id,
      externalPostUrl: `https://social.openg7.local/${job.feedId}/${job.id}`
    };
  }
  // Text, author and publication state must match. Media reconciliation requires a manual provider investigation.
  assert(!job.mediaId, 'MEDIA_RECONCILIATION_REQUIRED');
  if (job.feedId.endsWith(':facebook')) {
    assert(/^\d+_\d+$/.test(id), 'INVALID_POST_ID', 400);
    const { data } = await call(
      `${c.facebook.graphBaseUrl}/${encodeURIComponent(id)}?fields=id,from,message,is_published`,
      { headers: { Authorization: `Bearer ${c.facebook.pageAccessToken}` } }
    );
    assert(
      object(data.from).id === job.accountId &&
        data.message === job.message &&
        data.is_published === true,
      'POST_MISMATCH'
    );
    return {
      externalPostId: id,
      externalPostUrl: `https://www.facebook.com/${id}`
    };
  }
  assert(/^urn:li:(share|ugcPost):\d+$/.test(id), 'INVALID_POST_ID', 400);
  const { data } = await call(
    `${c.linkedin.apiBaseUrl}/posts/${encodeURIComponent(id)}`,
    { headers: headers(c) }
  );
  assert(
    data.author === author(job.accountId) &&
      data.commentary === job.message &&
      data.lifecycleState === 'PUBLISHED',
    'POST_MISMATCH'
  );
  return {
    externalPostId: id,
    externalPostUrl: `https://www.linkedin.com/feed/update/${id}/`
  };
}
export const safeCode = (error: unknown): string =>
  error instanceof DeliveryFailure ||
  error instanceof PublicationAutomationError
    ? error.code
    : 'DELIVERY_INTERRUPTED';
