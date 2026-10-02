// Configuration for the admin AI assistant, read from the environment.
//
// The platform must stay fully functional when the assistant is disabled, so
// every value has a safe default and `enabled` defaults to false. The provider
// API key is read but NEVER logged or returned to the client.

import {
  parseBooleanEnv as parseBool,
  parsePositiveIntegerEnv as parsePositiveInt
} from '../environment-values.js';

export type AdminAssistantProviderKind = 'disabled' | 'mock';

export interface AdminAssistantConfig {
  readonly enabled: boolean;
  /** Resolved, usable provider. Anything unknown collapses to `disabled`. */
  readonly provider: AdminAssistantProviderKind;
  /** True when the assistant is enabled AND a working provider is selected. */
  readonly providerConfigured: boolean;
  readonly rawProvider: string;
  readonly model: string | null;
  /** Present only so it is read from a single place; never logged/serialised. */
  readonly hasApiKey: boolean;
  readonly maxToolCalls: number;
  readonly timeoutMs: number;
  readonly maxMessageLength: number;
  readonly maxItemsPerTool: number;
}

type EnvSource = Record<string, string | undefined>;

export const loadAdminAssistantConfig = (
  env: EnvSource = process.env
): AdminAssistantConfig => {
  const enabled = parseBool(env.ADMIN_AI_ASSISTANT_ENABLED, false);
  const rawProvider = (env.ADMIN_AI_PROVIDER ?? '').trim().toLowerCase();
  const provider: AdminAssistantProviderKind =
    rawProvider === 'mock' ? 'mock' : 'disabled';
  const model = env.ADMIN_AI_MODEL?.trim() || null;
  const hasApiKey = Boolean(env.ADMIN_AI_API_KEY?.trim());

  return {
    enabled,
    provider,
    providerConfigured: enabled && provider !== 'disabled',
    rawProvider,
    model,
    hasApiKey,
    maxToolCalls: parsePositiveInt(env.ADMIN_AI_MAX_TOOL_CALLS, 6, 20),
    timeoutMs: parsePositiveInt(env.ADMIN_AI_TIMEOUT_MS, 15_000, 60_000),
    maxMessageLength: parsePositiveInt(
      env.ADMIN_AI_MAX_MESSAGE_LENGTH,
      2000,
      8000
    ),
    maxItemsPerTool: parsePositiveInt(env.ADMIN_AI_MAX_ITEMS_PER_TOOL, 25, 100)
  };
};
