import type {
  ApiRequest,
  ApiRequestListenerContext,
  ApiResponse
} from './contracts.js';

/** Compose the asynchronous error boundary without opening a server or workers. */
export const createApiRequestListener = ({
  handleRequest,
  writeJson,
  reportFailure
}: ApiRequestListenerContext) => {
  return (request: ApiRequest, response: ApiResponse): void => {
    void handleRequest(request, response).catch(() => {
      // Never log request bodies, tracking tokens or provider diagnostics here.
      reportFailure('Unhandled API request failure.');
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) response.destroy();
      else
        writeJson(request, response, 500, {
          code: 'INTERNAL_ERROR',
          error: 'The request could not be completed.'
        });
    });
  };
};
