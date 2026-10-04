import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminAccountInput,
  AdminIdentityConfig,
  AdminRole
} from './contracts.js';
import { roles } from './policy.js';

export const cookie = (request: IncomingMessage, name: string): string =>
  (request.headers.cookie ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? '';

export const setCookie = (
  response: ServerResponse,
  value: string,
  age: number,
  config: Pick<AdminIdentityConfig, 'cookieName' | 'secure'>,
  name = config.cookieName
): void => {
  response.setHeader(
    'Set-Cookie',
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.secure ? '; Secure' : ''}`
  );
};

export const json = (
  response: ServerResponse,
  status: number,
  value: unknown
): void => {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer'
  });
  response.end(JSON.stringify(value));
};

export const redirect = (response: ServerResponse, location: string): void => {
  response.writeHead(303, {
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer'
  });
  response.end();
};

export const readAccessChange = async (
  request: IncomingMessage
): Promise<Record<string, unknown>> => {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 4096) throw new Error('Body too large');
  }
  const input = JSON.parse(body) as Record<string, unknown>;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid account');
  return input;
};

export const hasAccessConfirmation = (
  input: Record<string, unknown>
): boolean => {
  const target = input.sessionId ?? input.subject;
  return (
    typeof target === 'string' && !!target && input.confirmation === target
  );
};

const isAdminRole = (value: string): value is AdminRole =>
  roles.includes(value);

export const parseAdminAccountInput = (
  input: Record<string, unknown>
): AdminAccountInput => {
  if (
    typeof input.subject !== 'string' ||
    !input.subject.trim() ||
    input.subject.length > 255 ||
    typeof input.displayName !== 'string' ||
    !input.displayName.trim() ||
    input.displayName.length > 120 ||
    typeof input.role !== 'string' ||
    !isAdminRole(input.role) ||
    typeof input.disabled !== 'boolean'
  )
    throw new Error('Invalid account');
  return {
    subject: input.subject,
    displayName: input.displayName.trim(),
    role: input.role,
    disabled: input.disabled
  };
};
