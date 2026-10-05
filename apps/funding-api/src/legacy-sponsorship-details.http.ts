import type { IncomingMessage, ServerResponse } from 'node:http';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

export interface LegacySponsorshipDetailsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
}

/** A Checkout identifier never authorizes changes to a private sponsorship dossier. */
export const createLegacySponsorshipDetailsHttpHandler = ({
  publicBaseOrigin,
  writeJson
}: LegacySponsorshipDetailsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<boolean> => {
    if (
      request.method !== 'POST' ||
      !routeMatches(
        request.url,
        '/sponsorship-details',
        '/api/sponsorship-details'
      )
    ) {
      return false;
    }

    // Refuse before parsing a private body, reading Stripe or changing persistence.
    writeJson(request, response, 410, {
      code: 'SPONSORSHIP_LEGACY_ENDPOINT_RETIRED',
      error: 'Use the private sponsorship follow-up with its access token.'
    });
    return true;
  };
};
