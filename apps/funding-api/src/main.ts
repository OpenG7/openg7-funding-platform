import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';

import Stripe from 'stripe';
import type {
  CheckoutResult,
  CheckoutRequest,
  RedirectCheckoutResult
} from '@openg7/funding-core';

import { dbPool, hasDatabase } from './database.js';
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
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

if (isProduction && !stripeSecretKey) {
  throw new Error(
    'STRIPE_SECRET_KEY is required when FUNDING_PLATFORM_ENV=production.'
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

const readBody = async (request: ApiRequest): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
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

    if (!Number.isFinite(parsed.amount) || parsed.amount <= 0) {
      writeJson(request, response, 400, {
        error: 'Checkout amount must be greater than zero.'
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
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: parsed.successUrl,
        cancel_url: parsed.cancelUrl,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: parsed.currency.toLowerCase(),
              unit_amount: Math.round(parsed.amount * 100),
              product_data: {
                name: `OpenG7 ${parsed.projectId}`
              }
            }
          }
        ],
        payment_intent_data: {
          metadata: {
            projectId: parsed.projectId
          }
        },
        metadata: {
          projectId: parsed.projectId
        }
      });

      const result: RedirectCheckoutResult = {
        checkoutId: session.id,
        redirectUrl: session.url ?? parsed.successUrl,
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

    const rawBody = await readBody(request);

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
