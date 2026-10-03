import type { IncomingMessage, ServerResponse } from 'node:http';

import type { processStripeWebhook } from './stripe-webhook.service.js';
import { createRouteMatcher } from './http-routing.js';
import type {
  createHttpTransport,
  readBody as readHttpBody
} from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface StripeWebhookHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly readBody: typeof readHttpBody;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isConfigured: boolean;
  readonly processStripeWebhook: (
    rawBody: string,
    stripeSignature: string
  ) => ReturnType<typeof processStripeWebhook>;
}

export const createStripeWebhookHttpHandler = ({
  publicBaseOrigin,
  readBody,
  writeJson,
  isConfigured,
  processStripeWebhook
}: StripeWebhookHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  const handleStripeWebhookRequest = async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'POST' &&
      routeMatches(request.url, '/stripe/webhook', '/api/stripe/webhook')
    ) {
      if (!isConfigured) {
        writeJson(request, response, 503, {
          error:
            'Stripe webhook is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
        });
        return true;
      }

      const stripeSignature = request.headers['stripe-signature'];
      if (typeof stripeSignature !== 'string') {
        writeJson(request, response, 400, {
          error: 'Missing Stripe-Signature header'
        });
        return true;
      }

      let rawBody: string;
      try {
        rawBody = await readBody(request);
      } catch {
        writeJson(request, response, 413, {
          error: 'Webhook request body is too large.'
        });
        return true;
      }

      const result = await processStripeWebhook(rawBody, stripeSignature);

      writeJson(request, response, result.statusCode, result.payload);
      return true;
    }

    return false;
  };

  return handleStripeWebhookRequest;
};
