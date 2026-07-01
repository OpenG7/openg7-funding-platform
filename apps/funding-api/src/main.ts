import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import Stripe from 'stripe';
import type {
  CheckoutRequest,
  RedirectCheckoutResult
} from '@openg7/funding-core';

import { dbPool, hasDatabase } from './database.js';
import { getPublicTransparencySummary } from './fund-transparency.repository.js';
import { processStripeWebhook } from './stripe-webhook.service.js';

const port = Number(process.env.FUNDING_API_PORT ?? 3333);
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

const writeJson = (
  response: ApiResponse,
  statusCode: number,
  payload: unknown
): void => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
};

const writeText = (
  response: ApiResponse,
  statusCode: number,
  payload: string
): void => {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(payload);
};

const readBody = async (request: ApiRequest): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const routeMatches = (url: string | undefined, ...candidates: readonly string[]): boolean =>
  Boolean(url && candidates.includes(url));

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
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
    const body = await readBody(request);
    const parsed = JSON.parse(body) as CheckoutRequest;

    if (!stripe) {
      const mockResult: RedirectCheckoutResult = {
        checkoutId: `stripe-mock-${parsed.projectId}-${parsed.amount}`,
        redirectUrl: 'https://example.org/mock-checkout',
        status: 'redirected'
      };
      writeJson(response, 200, mockResult);
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: parsed.successUrl,
      cancel_url: parsed.cancelUrl,
      currency: parsed.currency.toLowerCase(),
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
      metadata: {
        projectId: parsed.projectId
      }
    });

    const result: RedirectCheckoutResult = {
      checkoutId: session.id,
      redirectUrl: session.url ?? parsed.successUrl,
      status: 'redirected'
    };

    writeJson(response, 200, result);
    return;
  }

  if (
    request.method === 'POST' &&
    routeMatches(request.url, '/stripe/webhook', '/api/stripe/webhook')
  ) {
    if (!stripe || !stripeWebhookSecret) {
      writeJson(response, 503, {
        error:
          'Stripe webhook is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
      });
      return;
    }

    if (!hasDatabase) {
      writeJson(response, 503, {
        error: 'Database is not configured. Set DATABASE_URL.'
      });
      return;
    }

    const stripeSignature = request.headers['stripe-signature'];
    if (typeof stripeSignature !== 'string') {
      writeJson(response, 400, {
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

    writeJson(response, result.statusCode, result.payload);
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
    const summary = await getPublicTransparencySummary(dbPool);
    writeJson(response, 200, summary);
    return;
  }

  if (request.method === 'GET' && routeMatches(request.url, '/health')) {
    writeText(response, 200, 'ok');
    return;
  }

  writeJson(response, 404, { error: 'Not found' });
}).listen(port, () => {
  console.log(`Funding API listening on http://localhost:${port}`);
  if (!hasDatabase) {
    console.warn('DATABASE_URL is not configured. Transparency persistence is disabled.');
  }
});
