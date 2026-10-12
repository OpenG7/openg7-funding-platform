import type { PublicationDelivery } from '@openg7/funding-core';

import { linkedinPublicationImageIds } from '../../../../packages/funding-core/src/index.js';
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

export type PublicationDispatchMedia =
  | Buffer
  | readonly {
      readonly bytes: Buffer;
      readonly alt: string;
      readonly sha256: string;
    }[]
  | null;

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
  media: PublicationDispatchMedia,
  cachedImage: string | null = null,
  persistImage: (id: string) => Promise<void> = async () => {},
  assertActive: () => Promise<void> = async () => {}
): Promise<SocialPublicationProviderResult> {
  assert(c.mode !== 'disabled' && c.mode === job.mode, 'MODE_CHANGED');
  const collection = media !== null && !Buffer.isBuffer(media);
  assert(
    job.publicationFormat !== 'image_collection' ||
      (collection && job.feedId.endsWith(':linkedin')),
    'FORMAT_UNAVAILABLE'
  );
  if (collection) {
    assert(
      job.publicationFormat === 'image_collection' &&
        media.length >= 2 &&
        media.length <= 10 &&
        job.mediaImages?.length === media.length &&
        media.every(
          (image, index) =>
            image.sha256 === digest(image.bytes) &&
            image.sha256 === job.mediaImages?.[index]?.sha256 &&
            image.alt === job.mediaImages?.[index]?.alt
        ),
      'MEDIA_CHANGED'
    );
  }
  const ownedCall = async (...args: Parameters<typeof call>) => {
    await assertActive();
    return call(...args);
  };
  if (c.mode === 'mock') {
    if (c.mockBaseUrl) {
      const { data } = await ownedCall(
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
            mediaSha256: media && !collection ? digest(media) : null,
            ...(collection
              ? {
                  mediaImages: media.map((image) => ({
                    sha256: image.sha256,
                    alt: image.alt
                  }))
                }
              : {})
          })
        },
        true
      );
      if (data.id !== `mock-${job.id}`)
        throw new DeliveryFailure('PROVIDER_MISSING_ID', 'uncertain');
    } else await assertActive();
    return {
      externalPostId: `mock-${job.id}`,
      externalPostUrl: `https://social.openg7.local/${job.feedId}/${job.id}`
    };
  }
  if (job.feedId.endsWith(':facebook')) {
    assert(!collection, 'FORMAT_UNAVAILABLE');
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
    const { data } = await ownedCall(
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
  const images = collection
    ? media
    : media
      ? [{ bytes: media, alt: job.mediaAlt || '', sha256: digest(media) }]
      : [];
  const imageIds = linkedinPublicationImageIds(cachedImage);
  assert(!cachedImage || imageIds.length > 0, 'MEDIA_REFERENCE_INVALID');
  assert(imageIds.length <= images.length, 'MEDIA_REFERENCE_INVALID');
  for (let index = imageIds.length; index < images.length; index++) {
    const { data } = await ownedCall(
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
    const imageId = string(value.image);
    let upload: URL;
    try {
      upload = new URL(string(value.uploadUrl));
    } catch {
      throw new DeliveryFailure('INVALID_UPLOAD', 'rejected');
    }
    assert(
      upload.protocol === 'https:' &&
        upload.hostname === 'www.linkedin.com' &&
        (!upload.port || upload.port === '443') &&
        upload.pathname.startsWith('/dms-uploads/') &&
        !upload.username &&
        !upload.password &&
        !upload.hash &&
        /^urn:li:image:[A-Za-z0-9_-]+$/.test(imageId) &&
        !imageIds.includes(imageId),
      'INVALID_UPLOAD'
    );
    await ownedCall(upload.href, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${c.linkedin.accessToken}`,
        'Content-Type': 'image/jpeg'
      },
      body: new Uint8Array(images[index]!.bytes)
    });
    imageIds.push(imageId);
    await persistImage(collection ? JSON.stringify(imageIds) : imageId);
  }
  for (const imageId of imageIds) {
    // No public post exists at this point. A not-yet-available upload is safe to retry.
    const { data: image } = await ownedCall(
      `${c.linkedin.apiBaseUrl}/images/${encodeURIComponent(imageId)}`,
      { headers: headers(c) }
    );
    if (image.status !== 'AVAILABLE')
      throw new DeliveryFailure(
        'MEDIA_PROCESSING',
        image.status === 'PROCESSING_FAILED' ? 'rejected' : 'retry'
      );
  }
  const { response, data } = await ownedCall(
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
        ...(imageIds.length
          ? {
              content: collection
                ? {
                    multiImage: {
                      images: imageIds.map((id, index) => ({
                        id,
                        altText: images[index]!.alt
                      }))
                    }
                  }
                : { media: { id: imageIds[0], altText: job.mediaAlt || '' } }
            }
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
  id: string,
  expectedMediaIds: readonly string[] = []
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
  if (job.feedId.endsWith(':facebook')) {
    // Without a qualified immutable photo identity, a matching caption is insufficient.
    assert(!job.mediaId, 'MEDIA_RECONCILIATION_REQUIRED');
    assert(/^\d+_\d+$/.test(id), 'INVALID_POST_ID', 400);
    const { data } = await call(
      `${c.facebook.graphBaseUrl}/${encodeURIComponent(id)}?fields=id,from,message,is_published`,
      { headers: { Authorization: `Bearer ${c.facebook.pageAccessToken}` } }
    );
    assert(
      data.id === id &&
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
  if (job.mediaId)
    assert(
      expectedMediaIds.length > 0 &&
        expectedMediaIds.length <= 10 &&
        expectedMediaIds.every((mediaId) =>
          /^urn:li:image:[A-Za-z0-9_-]+$/.test(mediaId)
        ) &&
        new Set(expectedMediaIds).size === expectedMediaIds.length &&
        (job.publicationFormat === 'image_collection'
          ? expectedMediaIds.length === job.mediaImages?.length &&
            expectedMediaIds.length >= 2
          : expectedMediaIds.length === 1),
      'MEDIA_RECONCILIATION_REQUIRED'
    );
  else assert(expectedMediaIds.length === 0, 'MEDIA_REFERENCE_INVALID');
  const { data } = await call(
    `${c.linkedin.apiBaseUrl}/posts/${encodeURIComponent(id)}`,
    { headers: headers(c) }
  );
  assert(
    data.id === id &&
      data.author === author(job.accountId) &&
      data.commentary === job.message &&
      data.lifecycleState === 'PUBLISHED' &&
      data.visibility === 'PUBLIC',
    'POST_MISMATCH'
  );
  const content = object(data.content);
  const remoteMedia =
    job.publicationFormat === 'image_collection'
      ? object(content.multiImage).images
      : undefined;
  const actualIds = Array.isArray(remoteMedia)
    ? remoteMedia.map((image) => string(object(image).id))
    : content.media
      ? [string(object(content.media).id)]
      : [];
  assert(
    actualIds.length === expectedMediaIds.length &&
      actualIds.every(
        (mediaId, index) => mediaId === expectedMediaIds[index]
      ) &&
      (Array.isArray(remoteMedia)
        ? remoteMedia.every(
            (image, index) =>
              !('altText' in object(image)) ||
              object(image).altText === job.mediaImages?.[index]?.alt
          )
        : !('altText' in object(content.media)) ||
          object(content.media).altText === job.mediaAlt) &&
      !(content.multiImage && job.publicationFormat !== 'image_collection') &&
      !(content.media && job.publicationFormat === 'image_collection') &&
      Object.keys(content).every((key) =>
        ['media', 'multiImage'].includes(key)
      ),
    'POST_MISMATCH'
  );
  for (const imageId of expectedMediaIds) {
    const { data: image } = await call(
      `${c.linkedin.apiBaseUrl}/images/${encodeURIComponent(imageId)}`,
      { headers: headers(c) }
    );
    assert(
      typeof image.id === 'string' && typeof image.owner === 'string',
      'MEDIA_RECONCILIATION_REQUIRED'
    );
    assert(
      image.id === imageId && image.owner === author(job.accountId),
      'POST_MISMATCH'
    );
    if (image.status !== 'AVAILABLE')
      throw new DeliveryFailure('MEDIA_REMOTE_UNAVAILABLE', 'retry');
  }
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
