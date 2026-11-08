import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  PreflightInboxResponse,
  PreflightInboxUnavailable
} from '@openg7/funding-core';

import type { createHttpTransport } from '../http-transport.js';

import { PreflightClientError } from './client.js';
import { PreflightContractError } from './contracts.js';
import type { PreflightInboxConfig } from './inbox-config.js';
import { createPreflightInboxReader } from './inbox.js';

interface InboxHttpDependencies {
  publicBaseOrigin: string;
  config: PreflightInboxConfig;
  ensureAdminAuthorization: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  read?: ReturnType<typeof createPreflightInboxReader>;
}

const scopeHeader =
  /^(?:x-)?(?:(?:preflight|funding|source)-)?(?:tenant(?:[-_]id)?|applications?|allowed[-_]applications|roles?|subject)$/i;

/** Read-only Funding session boundary. Scope comes exclusively from backend configuration and its signed token. */
export function createPreflightInboxHttpHandler(deps: InboxHttpDependencies) {
  const read = deps.read ?? createPreflightInboxReader(deps.config);
  const writeJson: InboxHttpDependencies['writeJson'] = (
    request,
    response,
    status,
    payload
  ) =>
    deps.writeJson(request, response, status, payload, {
      'Cache-Control': 'private, no-store'
    });
  return async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    } catch {
      return false;
    }
    if (
      !['/api/admin/preflight/inbox', '/admin/preflight/inbox'].includes(
        url.pathname
      )
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAuthorization(request, response)) return true;
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      writeJson(request, response, 405, {
        code: 'METHOD_NOT_ALLOWED',
        error: 'This resource is read-only.'
      });
      return true;
    }
    const pageRaw = url.searchParams.get('page') ?? '1';
    const sizeRaw = url.searchParams.get('pageSize') ?? '20';
    if (
      [...url.searchParams.keys()].some(
        (key) =>
          !['page', 'pageSize'].includes(key) ||
          url.searchParams.getAll(key).length !== 1
      ) ||
      Object.keys(request.headers).some((key) => scopeHeader.test(key)) ||
      !/^[1-9]\d{0,5}$/.test(pageRaw) ||
      !/^[1-9]\d{0,2}$/.test(sizeRaw) ||
      Number(pageRaw) > 100000 ||
      Number(sizeRaw) > 100
    ) {
      writeJson(request, response, 400, {
        code: 'PREFLIGHT_INVALID_REQUEST',
        error: 'Invalid Preflight inbox query.'
      });
      return true;
    }
    const page = Number(pageRaw),
      pageSize = Number(sizeRaw);
    if (!deps.config.connection.enabled) {
      const payload: PreflightInboxResponse = {
        state: 'disabled',
        consoleUrl: deps.config.consoleUrl,
        items: [],
        total: 0,
        page,
        pageSize,
        authority: 'source_application',
        businessDecisionExecuted: false
      };
      writeJson(request, response, 200, payload);
      return true;
    }
    try {
      const result = await read(page, pageSize);
      const payload: PreflightInboxResponse = {
        ...result,
        state: 'ready',
        consoleUrl: deps.config.consoleUrl,
        authority: 'source_application',
        businessDecisionExecuted: false
      };
      writeJson(request, response, 200, payload);
    } catch (error) {
      const invalid =
        error instanceof PreflightContractError ||
        (error instanceof PreflightClientError &&
          [
            'preflight_response_invalid',
            'preflight_response_too_large',
            'preflight_token_response_invalid'
          ].includes(error.code));
      const payload: PreflightInboxUnavailable = {
        state: 'unavailable',
        consoleUrl: deps.config.consoleUrl,
        code: invalid ? 'PREFLIGHT_RESPONSE_INVALID' : 'PREFLIGHT_UNAVAILABLE',
        error: invalid
          ? 'Invalid Preflight inbox response.'
          : 'Preflight proposals are temporarily unavailable.'
      };
      writeJson(request, response, invalid ? 502 : 503, payload);
    }
    return true;
  };
}
