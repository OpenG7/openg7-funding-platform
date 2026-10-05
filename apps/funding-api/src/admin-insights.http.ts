import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminCockpitActivity,
  AdminCockpitMetrics,
  AdminCockpitSystems,
  AdminDashboardResponse,
  AdminSearchRequest,
  AdminSearchResponse,
  AdminStripeEventResponse,
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { createRouteMatcher, isJsonContentType } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;
type AdminAuthorizationCheck = (
  request: ApiRequest,
  response: ApiResponse
) => boolean;

/** Read-model ports keep HTTP routing independent of database and provider lifecycles. */
export interface AdminInsightsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAuthorization: AdminAuthorizationCheck;
  readonly ensureAdminAccess: AdminAuthorizationCheck;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly validStripeEventId: (value: string) => boolean;
  readonly getAdminStripeEvent: (
    id: string
  ) => Promise<AdminStripeEventResponse>;
  readonly parseAdminSearch: (body: unknown) => Required<AdminSearchRequest>;
  readonly searchAdmin: (
    query: AdminSearchRequest
  ) => Promise<AdminSearchResponse>;
  readonly parseWorkQueueQuery: (
    params: URLSearchParams
  ) => AdminWorkQueueQuery;
  readonly getAdminWorkQueue: (
    query: AdminWorkQueueQuery
  ) => Promise<AdminWorkQueueResponse>;
  readonly getCockpitMetrics: () => Promise<AdminCockpitMetrics>;
  readonly getCockpitActivity: () => Promise<AdminCockpitActivity>;
  readonly readCockpitSystems: () => Promise<AdminCockpitSystems>;
  readonly getAdminDashboard: () => Promise<AdminDashboardResponse>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Return false without side effects for routes and methods owned elsewhere. */
export const createAdminInsightsHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAuthorization,
  ensureAdminAccess,
  readBody,
  writeJson,
  validStripeEventId,
  getAdminStripeEvent,
  parseAdminSearch,
  searchAdmin,
  parseWorkQueueQuery,
  getAdminWorkQueue,
  getCockpitMetrics,
  getCockpitActivity,
  readCockpitSystems,
  getAdminDashboard,
  reportFailure
}: AdminInsightsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/stripe-event',
        '/api/admin/stripe-event'
      )
    ) {
      if (!ensureAdminAuthorization(request, response)) return true;
      const headers = { 'Cache-Control': 'private, no-store' };
      const id =
        new URL(request.url!, publicBaseOrigin).searchParams.get('eventId') ??
        '';
      if (!validStripeEventId(id)) {
        writeJson(
          request,
          response,
          400,
          { error: 'Invalid event identifier.' },
          headers
        );
        return true;
      }
      try {
        writeJson(
          request,
          response,
          200,
          await getAdminStripeEvent(id),
          headers
        );
      } catch {
        writeJson(
          request,
          response,
          503,
          { error: 'Event unavailable.' },
          headers
        );
      }
      return true;
    }
    if (routeMatches(request.url, '/admin/search', '/api/admin/search')) {
      response.setHeader('Cache-Control', 'private, no-store');
      if (!ensureAdminAuthorization(request, response)) return true;
      const headers = { 'Cache-Control': 'private, no-store' };
      if (request.method !== 'POST') {
        writeJson(
          request,
          response,
          405,
          { error: 'Use POST for admin search.' },
          { ...headers, Allow: 'POST' }
        );
        return true;
      }
      if (!isJsonContentType(request.headers['content-type'])) {
        writeJson(
          request,
          response,
          415,
          { error: 'JSON body required.' },
          headers
        );
        return true;
      }
      let query;
      try {
        query = parseAdminSearch(JSON.parse(await readBody(request, 4096)));
      } catch {
        writeJson(
          request,
          response,
          400,
          { error: 'Invalid search or pagination.' },
          headers
        );
        return true;
      }
      try {
        writeJson(request, response, 200, await searchAdmin(query), headers);
      } catch {
        // Database errors can contain query parameters: never log them here.
        writeJson(
          request,
          response,
          503,
          { error: 'Admin search unavailable.' },
          headers
        );
      }
      return true;
    }
    if (
      request.method === 'GET' &&
      routeMatches(request.url, '/admin/attention', '/api/admin/attention')
    ) {
      if (!ensureAdminAuthorization(request, response)) return true;
      let query;
      try {
        query = parseWorkQueueQuery(
          new URL(request.url ?? '/', publicBaseOrigin).searchParams
        );
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid attention filters or pagination.'
        });
        return true;
      }
      try {
        writeJson(request, response, 200, await getAdminWorkQueue(query), {
          'Cache-Control': 'private, no-store'
        });
      } catch {
        writeJson(request, response, 502, {
          error: 'Admin attention queue could not be loaded.'
        });
      }
      return true;
    }
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/cockpit/metrics',
        '/api/admin/cockpit/metrics',
        '/admin/cockpit/activity',
        '/api/admin/cockpit/activity',
        '/admin/cockpit/systems',
        '/api/admin/cockpit/systems'
      )
    ) {
      if (!ensureAdminAuthorization(request, response)) return true;
      const path = new URL(request.url!, publicBaseOrigin).pathname;
      try {
        const result = path.endsWith('/metrics')
          ? await getCockpitMetrics()
          : path.endsWith('/activity')
            ? await getCockpitActivity()
            : await readCockpitSystems();
        writeJson(request, response, 200, result, {
          'Cache-Control': 'private, no-store'
        });
      } catch {
        writeJson(
          request,
          response,
          503,
          { error: 'Cockpit data unavailable.', code: 'COCKPIT_UNAVAILABLE' },
          { 'Cache-Control': 'private, no-store' }
        );
      }
      return true;
    }
    if (
      request.method === 'GET' &&
      routeMatches(request.url, '/admin/dashboard', '/api/admin/dashboard')
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }
      try {
        const result = await getAdminDashboard();
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load admin dashboard.', error);
        writeJson(request, response, 502, {
          error: 'Admin dashboard could not be loaded.'
        });
      }
      return true;
    }

    return false;
  };
};
