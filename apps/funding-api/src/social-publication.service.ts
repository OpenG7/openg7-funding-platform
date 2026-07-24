import type {
  AdminSocialPublicationJobRecord,
  SocialPublicationMode,
  SponsorFeedChannel
} from '@openg7/funding-core';

export interface SocialPublicationConfig {
  readonly mode: SocialPublicationMode;
  readonly facebook: {
    readonly graphBaseUrl: string;
    readonly pageId: string;
    readonly pageAccessToken: string;
  };
  readonly linkedin: {
    readonly apiBaseUrl: string;
    readonly organizationId: string;
    readonly accessToken: string;
    readonly version: string;
  };
}

export interface SocialPublicationProviderResult {
  readonly externalPostId: string;
  readonly externalPostUrl: string | null;
}

export class SocialPublicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SocialPublicationError';
    this.code = code;
  }
}

const socialPublicationModes = new Set<SocialPublicationMode>([
  'disabled',
  'mock',
  'live'
]);

const trimmed = (value: string | undefined): string => value?.trim() ?? '';

const normalizeSocialPublicationMode = (
  value: string | undefined
): SocialPublicationMode => {
  const mode = trimmed(value).toLowerCase();
  return socialPublicationModes.has(mode as SocialPublicationMode)
    ? (mode as SocialPublicationMode)
    : 'disabled';
};

const stripTrailingSlash = (value: string): string =>
  value.endsWith('/') ? value.slice(0, -1) : value;

export const loadSocialPublicationConfig = (
  env: NodeJS.ProcessEnv = process.env
): SocialPublicationConfig => ({
  mode: normalizeSocialPublicationMode(env.SOCIAL_PUBLICATION_MODE),
  facebook: {
    graphBaseUrl: stripTrailingSlash(
      trimmed(env.SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL) ||
        'https://graph.facebook.com/v25.0'
    ),
    pageId: trimmed(env.SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID),
    pageAccessToken: trimmed(env.SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN)
  },
  linkedin: {
    apiBaseUrl: stripTrailingSlash(
      trimmed(env.SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL) ||
        'https://api.linkedin.com/rest'
    ),
    organizationId: trimmed(env.SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID),
    accessToken: trimmed(env.SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN),
    version: trimmed(env.SOCIAL_PUBLICATION_LINKEDIN_VERSION) || '202606'
  }
});

export const configuredSocialPublicationChannels = (
  config: SocialPublicationConfig
): readonly SponsorFeedChannel[] => {
  if (config.mode === 'disabled') {
    return [];
  }

  if (config.mode === 'mock') {
    return ['facebook', 'linkedin'];
  }

  return (['facebook', 'linkedin'] as const).filter((channel) =>
    isSocialPublicationChannelConfigured(config, channel)
  );
};

export const isSocialPublicationChannelConfigured = (
  config: SocialPublicationConfig,
  channel: SponsorFeedChannel
): boolean => {
  if (config.mode === 'disabled') {
    return false;
  }

  if (config.mode === 'mock') {
    return true;
  }

  return channel === 'facebook'
    ? Boolean(config.facebook.pageId && config.facebook.pageAccessToken)
    : Boolean(config.linkedin.organizationId && config.linkedin.accessToken);
};

export const socialPublicationProviderForChannel = (
  channel: SponsorFeedChannel
): 'facebook' | 'linkedin' =>
  channel === 'linkedin' ? 'linkedin' : 'facebook';

const socialMessageForJob = (job: AdminSocialPublicationJobRecord): string =>
  [job.title, job.body, job.disclosureText].filter(Boolean).join('\n\n');

export const publishSocialPublicationJob = async (
  config: SocialPublicationConfig,
  job: AdminSocialPublicationJobRecord
): Promise<SocialPublicationProviderResult> => {
  if (config.mode === 'disabled') {
    throw new SocialPublicationError(
      'SOCIAL_PUBLICATION_DISABLED',
      'Social publication automation is disabled.'
    );
  }

  if (!isSocialPublicationChannelConfigured(config, job.channel)) {
    throw new SocialPublicationError(
      'SOCIAL_PUBLICATION_CHANNEL_NOT_CONFIGURED',
      'Social publication channel is not configured.'
    );
  }

  if (config.mode === 'mock') {
    return {
      externalPostId: `mock-${job.channel}-${job.id.slice(0, 8)}`,
      externalPostUrl: `https://social.openg7.local/${job.channel}/${job.id}`
    };
  }

  return job.channel === 'facebook'
    ? publishFacebookPost(config, job)
    : publishLinkedInPost(config, job);
};

const publishFacebookPost = async (
  config: SocialPublicationConfig,
  job: AdminSocialPublicationJobRecord
): Promise<SocialPublicationProviderResult> => {
  const body = new URLSearchParams({
    message: socialMessageForJob(job),
    access_token: config.facebook.pageAccessToken
  });
  const response = await fetch(
    `${config.facebook.graphBaseUrl}/${encodeURIComponent(
      config.facebook.pageId
    )}/feed`,
    {
      method: 'POST',
      body
    }
  );

  const payload = await parseProviderPayload(response);
  if (!response.ok) {
    throw providerError('FACEBOOK_PUBLICATION_FAILED', payload);
  }

  const externalPostId = stringField(payload, 'id');
  if (!externalPostId) {
    throw new SocialPublicationError(
      'FACEBOOK_PUBLICATION_MISSING_ID',
      'Facebook did not return a post id.'
    );
  }

  return {
    externalPostId,
    externalPostUrl: `https://www.facebook.com/${externalPostId}`
  };
};

const linkedinAuthorUrn = (organizationId: string): string =>
  organizationId.startsWith('urn:li:organization:')
    ? organizationId
    : `urn:li:organization:${organizationId}`;

const linkedinPostUrl = (postId: string): string | null =>
  postId.startsWith('urn:li:ugcPost:') || postId.startsWith('urn:li:share:')
    ? `https://www.linkedin.com/feed/update/${postId}/`
    : null;

const publishLinkedInPost = async (
  config: SocialPublicationConfig,
  job: AdminSocialPublicationJobRecord
): Promise<SocialPublicationProviderResult> => {
  const response = await fetch(`${config.linkedin.apiBaseUrl}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.linkedin.accessToken}`,
      'Content-Type': 'application/json',
      'Linkedin-Version': config.linkedin.version,
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author: linkedinAuthorUrn(config.linkedin.organizationId),
      commentary: socialMessageForJob(job),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    })
  });

  const payload = await parseProviderPayload(response);
  if (!response.ok && response.status !== 201) {
    throw providerError('LINKEDIN_PUBLICATION_FAILED', payload);
  }

  const externalPostId =
    response.headers.get('x-restli-id') ?? stringField(payload, 'id');
  if (!externalPostId) {
    throw new SocialPublicationError(
      'LINKEDIN_PUBLICATION_MISSING_ID',
      'LinkedIn did not return a post id.'
    );
  }

  return {
    externalPostId,
    externalPostUrl: linkedinPostUrl(externalPostId)
  };
};

const parseProviderPayload = async (
  response: Response
): Promise<Record<string, unknown>> => {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { raw: text.slice(0, 500) };
  } catch {
    return { raw: text.slice(0, 500) };
  }
};

const stringField = (
  value: Record<string, unknown>,
  fieldName: string
): string | null => {
  const field = value[fieldName];
  return typeof field === 'string' && field.trim() ? field : null;
};

const providerError = (
  code: string,
  payload: Record<string, unknown>
): SocialPublicationError => {
  const nestedError =
    typeof payload.error === 'object' && payload.error !== null
      ? (payload.error as Record<string, unknown>)
      : null;
  const message =
    (nestedError && stringField(nestedError, 'message')) ||
    stringField(payload, 'message') ||
    stringField(payload, 'raw') ||
    'Social publication provider rejected the request.';

  return new SocialPublicationError(code, message.slice(0, 1000));
};
