import type { IncomingMessage, ServerResponse } from 'node:http';

import { createRouteMatcher } from './http-routing.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface HttpTransportConfig {
  readonly isProduction: boolean;
  readonly allowedOrigins: readonly string[];
}

const securityHeaders: Record<string, string> = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

export const createHttpTransport = ({
  isProduction,
  allowedOrigins
}: HttpTransportConfig) => {
  const { routeMatches, routeStartsWith } =
    createRouteMatcher('http://api.invalid');
  const privateResponseHeaders = (
    request: ApiRequest,
    extraHeaders: Record<string, string> = {}
  ): Record<string, string> =>
    routeStartsWith(
      request.url,
      '/admin/',
      '/api/admin/',
      '/sponsorship-followup/',
      '/api/sponsorship-followup/'
    ) ||
    routeMatches(
      request.url,
      '/sponsorship-followup',
      '/api/sponsorship-followup'
    )
      ? {
          'Cache-Control': extraHeaders['Cache-Control']
            ?.split(',')
            .some((value) => value.trim().toLowerCase() === 'no-store')
            ? extraHeaders['Cache-Control']
            : 'no-store'
        }
      : {};

  const createCorsHeaders = (request: ApiRequest): Record<string, string> => {
    const origin = request.headers.origin;
    const allowedOrigin = !isProduction
      ? '*'
      : typeof origin === 'string' && allowedOrigins.includes(origin)
        ? origin
        : null;
    const headers: Record<string, string> = { Vary: 'Origin' };

    if (allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin;
    }

    return headers;
  };

  const writeResponseHeaders = (
    request: ApiRequest,
    response: ApiResponse,
    statusCode: number,
    contentType: string,
    extraHeaders: Record<string, string> = {}
  ): void => {
    response.writeHead(statusCode, {
      ...createCorsHeaders(request),
      ...securityHeaders,
      ...extraHeaders,
      ...privateResponseHeaders(request, extraHeaders),
      'Content-Type': contentType
    });
  };

  const writeJson = (
    request: ApiRequest,
    response: ApiResponse,
    statusCode: number,
    payload: unknown,
    extraHeaders: Record<string, string> = {}
  ): void => {
    writeResponseHeaders(
      request,
      response,
      statusCode,
      'application/json; charset=utf-8',
      extraHeaders
    );
    response.end(JSON.stringify(payload));
  };

  const writeText = (
    request: ApiRequest,
    response: ApiResponse,
    statusCode: number,
    payload: string
  ): void => {
    writeResponseHeaders(
      request,
      response,
      statusCode,
      'text/plain; charset=utf-8'
    );
    response.end(payload);
  };

  const writeCsv = (
    request: ApiRequest,
    response: ApiResponse,
    statusCode: number,
    payload: string,
    filename: string
  ): void => {
    writeResponseHeaders(
      request,
      response,
      statusCode,
      'text/csv; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="${filename}"` }
    );
    response.end(payload);
  };

  const writeBinary = (
    request: ApiRequest,
    response: ApiResponse,
    statusCode: number,
    payload: Buffer,
    contentType: string,
    extraHeaders: Record<string, string> = {}
  ): void => {
    writeResponseHeaders(request, response, statusCode, contentType, {
      ...extraHeaders,
      'Content-Length': String(payload.byteLength)
    });
    response.end(payload);
  };

  const writePdf = (
    request: ApiRequest,
    response: ApiResponse,
    statusCode: number,
    payload: Buffer,
    filename: string
  ): void => {
    writeBinary(request, response, statusCode, payload, 'application/pdf', {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filename}"`
    });
  };

  const writeOptions = (request: ApiRequest, response: ApiResponse): void => {
    response.writeHead(204, {
      ...createCorsHeaders(request),
      ...securityHeaders,
      'Access-Control-Allow-Headers':
        'Content-Type, Stripe-Signature, Authorization, X-Funding-Admin-Token, X-Sponsorship-Followup-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    response.end();
  };

  return {
    writeJson,
    writeText,
    writeCsv,
    writeBinary,
    writePdf,
    writeOptions
  };
};

export const readBodyBuffer = async (
  request: ApiRequest,
  maxBytes: number
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  // A body-limit rejection must leave the socket available for the HTTP response.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      chunks.length = 0;
      // Resume after iterator cleanup so its readable listener cannot pause the drain.
      setImmediate(() => request.resume());
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const readBody = async (
  request: ApiRequest,
  maxBytes = 256 * 1024
): Promise<string> =>
  (await readBodyBuffer(request, maxBytes)).toString('utf8');
