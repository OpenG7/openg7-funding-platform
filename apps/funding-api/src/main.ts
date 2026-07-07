import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';

import Stripe from 'stripe';
import type {
  ContributionType,
  CheckoutResult,
  CheckoutRequest,
  RedirectCheckoutResult
} from '@openg7/funding-core';

import { dbPool, hasDatabase } from './database.js';
import { insertCheckoutSessionRecord } from './fund-contributions.repository.js';
import { getPublicTransparencySummary } from './fund-transparency.repository.js';
import { getStripePublicTransparencySummary } from './stripe-transparency.service.js';
import { processStripeWebhook } from './stripe-webhook.service.js';

const port = Number(process.env.FUNDING_API_PORT ?? 3333);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const projectId = process.env.FUNDING_PROJECT_ID ?? 'openg7';
const isProduction = process.env.FUNDING_PLATFORM_ENV === 'production';
const allowedOrigins = (process.env.FUNDING_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const publicBaseUrl =
  process.env.FUNDING_PUBLIC_BASE_URL ??
  allowedOrigins[0] ??
  (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : null);
const publicBaseOrigin = publicBaseUrl
  ? new URL(publicBaseUrl).origin
  : 'https://example.org';
const allowedReturnHostnames = new Set(
  [publicBaseUrl, ...allowedOrigins]
    .filter(Boolean)
    .map((origin) => new URL(origin).hostname)
);
const allowedContributionAmounts = new Set(
  (process.env.FUNDING_ALLOWED_AMOUNTS ?? '5,10,25,50')
    .split(',')
    .map((amount) => Number(amount.trim()))
    .filter((amount) => Number.isFinite(amount) && amount > 0)
);
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const allowedContributionTypes = new Set<ContributionType>([
  'personal_support',
  'sponsorship_interest'
]);

if (isProduction && !stripeSecretKey) {
  throw new Error(
    'STRIPE_SECRET_KEY is required when FUNDING_PLATFORM_ENV=production.'
  );
}

if (isProduction && !publicBaseUrl) {
  throw new Error(
    'FUNDING_PUBLIC_BASE_URL or FUNDING_ALLOWED_ORIGINS is required in production.'
  );
}

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

const writeJson = (
  request: ApiRequest,
  response: ApiResponse,
  statusCode: number,
  payload: unknown
): void => {
  response.writeHead(statusCode, {
    ...createCorsHeaders(request),
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
};

const writeText = (
  request: ApiRequest,
  response: ApiResponse,
  statusCode: number,
  payload: string
): void => {
  response.writeHead(statusCode, {
    ...createCorsHeaders(request),
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(payload);
};

const resolveAllowedOrigin = (request: ApiRequest): string | null => {
  const origin = request.headers.origin;

  if (!isProduction) {
    return '*';
  }

  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    return origin;
  }

  return null;
};

const createCorsHeaders = (request: ApiRequest): Record<string, string> => {
  const allowedOrigin = resolveAllowedOrigin(request);
  const headers: Record<string, string> = {
    Vary: 'Origin'
  };

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  return headers;
};

const readBody = async (
  request: ApiRequest,
  maxBytes = 256 * 1024
): Promise<string> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const normalizeAmount = (amount: number): number =>
  Number(Number(amount).toFixed(2));

const isAllowedContributionType = (
  contributionType: unknown
): contributionType is ContributionType =>
  typeof contributionType === 'string' &&
  allowedContributionTypes.has(contributionType as ContributionType);

const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

const resolveCheckoutReturnUrl = (
  candidateUrl: string,
  fallbackPath: string
): string => {
  const fallback = new URL(fallbackPath, publicBaseOrigin);

  try {
    const candidate = new URL(candidateUrl);
    const allowedOriginSet = new Set([
      ...allowedOrigins,
      publicBaseOrigin
    ]);

    if (candidate.protocol !== 'https:') {
      return fallback.toString();
    }

    if (candidate.port && allowedReturnHostnames.has(candidate.hostname)) {
      return new URL(
        `${candidate.pathname}${candidate.search}${candidate.hash}`,
        publicBaseOrigin
      ).toString();
    }

    if (allowedOriginSet.has(candidate.origin)) {
      return candidate.toString();
    }
  } catch {
    return fallback.toString();
  }

  return fallback.toString();
};

const routeMatches = (
  url: string | undefined,
  ...candidates: readonly string[]
): boolean => Boolean(url && candidates.includes(url));

const getDatabaseConnectionStatus = async (): Promise<boolean> => {
  if (!dbPool) {
    return false;
  }

  try {
    await dbPool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

const createDevelopmentCheckoutResult = (
  request: CheckoutRequest
): CheckoutResult => ({
  checkoutId: `stripe-dev-fallback-${request.projectId}-${request.amount}`,
  redirectUrl: request.successUrl,
  status: 'mocked'
});

const resolveStripePaymentIntentId = (
  paymentIntent: string | Stripe.PaymentIntent | null
): string | null => {
  if (!paymentIntent) {
    return null;
  }

  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
};

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...createCorsHeaders(request),
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    response.end();
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(request.url, '/checkout-sessions', '/api/checkout-sessions')
  ) {
    let parsed: CheckoutRequest;
    try {
      const body = await readBody(request);
      parsed = JSON.parse(body) as CheckoutRequest;
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid checkout request body.'
      });
      return;
    }

    const amount = normalizeAmount(parsed.amount);
    if (!Number.isFinite(amount) || !allowedContributionAmounts.has(amount)) {
      writeJson(request, response, 400, {
        error: 'Checkout amount is not allowed.'
      });
      return;
    }

    if (!isAllowedContributionType(parsed.contributionType)) {
      writeJson(request, response, 400, {
        error: 'Checkout contribution type is not allowed.'
      });
      return;
    }

    if (
      !isBoolean(parsed.publicDisplayConsent) ||
      !isBoolean(parsed.displayAmountConsent) ||
      parsed.nonCharityAcknowledged !== true
    ) {
      writeJson(request, response, 400, {
        error: 'Checkout consent fields are invalid or incomplete.'
      });
      return;
    }

    if (!stripe) {
      if (!isProduction) {
        writeJson(
          request,
          response,
          200,
          createDevelopmentCheckoutResult(parsed)
        );
        return;
      }

      writeJson(request, response, 503, {
        error: 'Stripe checkout is not configured.'
      });
      return;
    }

    try {
      const successUrl = resolveCheckoutReturnUrl(
        parsed.successUrl,
        '/?checkout=success'
      );
      const cancelUrl = resolveCheckoutReturnUrl(
        parsed.cancelUrl,
        '/?checkout=cancel'
      );
      const requiresReview =
        parsed.contributionType === 'sponsorship_interest';
      const checkoutMetadata: Record<string, string> = {
        projectId,
        project: 'openg7',
        program: 'builders_fund',
        contributionType: parsed.contributionType,
        publicDisplayConsent: String(parsed.publicDisplayConsent),
        displayAmountConsent: String(parsed.displayAmountConsent),
        nonCharityAcknowledged: String(parsed.nonCharityAcknowledged),
        requiresReview: String(requiresReview)
      };

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'cad',
              unit_amount: Math.round(amount * 100),
              product_data: {
                name: `OpenG7 ${projectId}`
              }
            }
          }
        ],
        payment_intent_data: {
          metadata: checkoutMetadata
        },
        metadata: checkoutMetadata
      });
      try {
        await insertCheckoutSessionRecord(dbPool, {
          stripeSessionId: session.id,
          stripePaymentIntentId: resolveStripePaymentIntentId(
            session.payment_intent
          ),
          contributionType: parsed.contributionType,
          amountCents: Math.round(amount * 100),
          currency: 'cad',
          metadata: checkoutMetadata,
          publicDisplayConsent: parsed.publicDisplayConsent,
          displayAmountConsent: parsed.displayAmountConsent,
          nonCharityAcknowledged: parsed.nonCharityAcknowledged
        });
      } catch (error) {
        console.error('Failed to record Stripe checkout session.', error);
      }

      const result: RedirectCheckoutResult = {
        checkoutId: session.id,
        redirectUrl: session.url ?? successUrl,
        status: 'redirected'
      };

      writeJson(request, response, 200, result);
      return;
    } catch (error) {
      console.error('Failed to create Stripe checkout session.', error);

      if (!isProduction) {
        writeJson(
          request,
          response,
          200,
          createDevelopmentCheckoutResult(parsed)
        );
        return;
      }

      writeJson(request, response, 502, {
        error: 'Stripe checkout session could not be created.'
      });
      return;
    }
  }

  if (
    request.method === 'POST' &&
    routeMatches(request.url, '/stripe/webhook', '/api/stripe/webhook')
  ) {
    if (!stripe || !stripeWebhookSecret) {
      writeJson(request, response, 503, {
        error:
          'Stripe webhook is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
      });
      return;
    }

    const stripeSignature = request.headers['stripe-signature'];
    if (typeof stripeSignature !== 'string') {
      writeJson(request, response, 400, {
        error: 'Missing Stripe-Signature header'
      });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(request);
    } catch {
      writeJson(request, response, 413, {
        error: 'Webhook request body is too large.'
      });
      return;
    }

    const result = await processStripeWebhook(rawBody, stripeSignature, {
      stripe,
      webhookSecret: stripeWebhookSecret,
      pool: dbPool
    });

    writeJson(request, response, result.statusCode, result.payload);
    return;
  }

  if (
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/public/fund-transparency',
      '/api/public/fund-transparency'
    )
  ) {
    try {
      const summary = hasDatabase
        ? await getPublicTransparencySummary(dbPool)
        : stripe
          ? await getStripePublicTransparencySummary(stripe, { projectId })
          : await getPublicTransparencySummary(null);

      writeJson(request, response, 200, summary);
    } catch (error) {
      console.error('Failed to build public fund transparency summary.', error);
      writeJson(request, response, 502, {
        error:
          'Public fund transparency summary could not be loaded from Stripe.'
      });
    }
    return;
  }

  if (request.method === 'GET' && routeMatches(request.url, '/health')) {
    writeText(request, response, 200, 'ok');
    return;
  }

  if (
    !isProduction &&
    request.method === 'GET' &&
    routeMatches(
      request.url,
      '/dev/stripe-setup-status',
      '/api/dev/stripe-setup-status'
    )
  ) {
    writeJson(request, response, 200, {
      environment: process.env.FUNDING_PLATFORM_ENV ?? 'development',
      apiReachable: true,
      stripeSecretKeyConfigured: Boolean(stripeSecretKey),
      stripeWebhookSecretConfigured: Boolean(stripeWebhookSecret),
      databaseUrlConfigured: hasDatabase,
      databaseReachable: await getDatabaseConnectionStatus(),
      transparencySource: hasDatabase ? 'database' : stripe ? 'stripe' : 'none',
      localApiBaseUrl: `http://localhost:${port}`,
      checkoutEndpoint: `http://localhost:${port}/api/checkout-sessions`,
      webhookEndpoint: `http://localhost:${port}/api/stripe/webhook`,
      publicTransparencyEndpoint: `http://localhost:${port}/api/public/fund-transparency`,
      stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
      lastCheckedAt: new Date().toISOString()
    });
    return;
  }

  writeJson(request, response, 404, { error: 'Not found' });
}).listen(port, () => {
  console.log(`Funding API listening on http://localhost:${port}`);
  if (!hasDatabase) {
    console.info(
      'DATABASE_URL is not configured. Using Stripe-direct public transparency.'
    );
  }
});
