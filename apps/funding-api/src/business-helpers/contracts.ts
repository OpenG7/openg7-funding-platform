import type { IncomingMessage, ServerResponse } from 'node:http';

export type WriteJson = (
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown
) => void;

export type ReportFailure = (message: string, error: unknown) => void;

export type ReportWarning = (message: string, details: unknown) => void;
