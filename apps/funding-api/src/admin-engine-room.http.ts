import type { IncomingMessage, ServerResponse } from 'node:http';

import type { EngineRoomScope, EngineRoomSnapshot } from '@openg7/funding-core';

import type { createHttpTransport } from './http-transport.js';
import { isValidUuid } from './business-helpers/request-validation.js';

export interface EngineRoomHttpPorts {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    req: IncomingMessage,
    res: ServerResponse
  ) => boolean;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly read: (scope: EngineRoomScope) => Promise<EngineRoomSnapshot>;
}
export function createAdminEngineRoomHttpHandler(ports: EngineRoomHttpPorts) {
  return async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> => {
    const url = new URL(req.url ?? '/', ports.publicBaseOrigin);
    if (
      !['/admin/engine-room', '/api/admin/engine-room'].includes(url.pathname)
    )
      return false;
    if (!ports.ensureAdminAccess(req, res)) return true;
    const headers = { 'Cache-Control': 'private, no-store' };
    if (req.method !== 'GET') {
      ports.writeJson(
        req,
        res,
        405,
        { code: 'METHOD_NOT_ALLOWED' },
        { ...headers, Allow: 'GET' }
      );
      return true;
    }
    const params = url.searchParams;
    if (
      [...params.keys()].some(
        (key) =>
          !['sponsorshipId', 'deliveryId'].includes(key) ||
          params.getAll(key).length !== 1 ||
          !isValidUuid(params.get(key))
      )
    ) {
      ports.writeJson(req, res, 400, { code: 'INVALID_ENGINE_SCOPE' }, headers);
      return true;
    }
    const scope: EngineRoomScope = {
      ...(params.has('sponsorshipId')
        ? { sponsorshipId: params.get('sponsorshipId')! }
        : {}),
      ...(params.has('deliveryId')
        ? { deliveryId: params.get('deliveryId')! }
        : {})
    };
    try {
      ports.writeJson(req, res, 200, await ports.read(scope), headers);
    } catch {
      ports.writeJson(
        req,
        res,
        503,
        { code: 'ENGINE_ROOM_UNAVAILABLE' },
        headers
      );
    }
    return true;
  };
}
