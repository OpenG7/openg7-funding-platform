// Orchestrates a single admin assistant query end to end.
//
// Responsibilities: enforce the enabled/configured gates, load the
// deterministic dataset once, build the closed tool registry, run the provider
// under a timeout and tool-call budget, and map everything to the structured,
// anti-hallucination `AdminAssistantQueryResponse`. It never writes data.

import type {
  AdminAssistantQueryResponse,
  AdminAssistantQueryStatus
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import type { AdminAssistantConfig } from './config.js';
import {
  buildSummaryFromDataset,
  loadAttentionDataset
} from './attention.service.js';
import { ADMIN_ASSISTANT_SYSTEM_PROMPT } from './prompt.js';
import { resolveAdminAssistantProvider } from './provider.js';
import { createAssistantToolRegistry } from './tool-registry.js';

export interface RunAdminAssistantQueryInput {
  readonly pool: Pool | null;
  readonly message: string;
  readonly config: AdminAssistantConfig;
  readonly now?: Date;
}

const DEFAULT_LIMITATIONS = [
  "L'assistant est en lecture seule : aucune donnée n'est modifiée.",
  'Aucune action financière (approbation, remboursement, publication) ne peut être exécutée.'
];

class TimeoutError extends Error {}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const baseResponse = (
  config: AdminAssistantConfig,
  now: Date,
  providerName: string
): Pick<
  AdminAssistantQueryResponse,
  'generatedAt' | 'mode' | 'enabled' | 'links' | 'toolInvocations' | 'provider'
> => ({
  generatedAt: now.toISOString(),
  mode: config.enabled ? config.provider : 'disabled',
  enabled: config.enabled,
  links: [],
  toolInvocations: [],
  provider: { name: providerName, model: config.model }
});

const disabledResponse = (
  config: AdminAssistantConfig,
  now: Date,
  status: AdminAssistantQueryStatus,
  headline: string
): AdminAssistantQueryResponse => ({
  ...baseResponse(config, now, 'disabled'),
  status,
  answer: [
    {
      kind: 'data_unavailable',
      title: 'Assistant conversationnel indisponible',
      lines: [headline]
    }
  ],
  limitations: DEFAULT_LIMITATIONS
});

export const runAdminAssistantQuery = async (
  input: RunAdminAssistantQueryInput
): Promise<AdminAssistantQueryResponse> => {
  const { config } = input;
  const now = input.now ?? new Date();

  if (!config.enabled) {
    return disabledResponse(
      config,
      now,
      'assistant_disabled',
      "L'assistant IA est désactivé. Le résumé déterministe reste disponible."
    );
  }

  const provider = resolveAdminAssistantProvider(config);
  if (!provider) {
    return disabledResponse(
      config,
      now,
      'provider_not_configured',
      "Aucun fournisseur de modèle n'est configuré. Le résumé déterministe reste disponible."
    );
  }

  const dataset = await loadAttentionDataset(input.pool, now);
  const summary = buildSummaryFromDataset(dataset, config.maxItemsPerTool);
  const registry = createAssistantToolRegistry(config.maxItemsPerTool);

  let output;
  try {
    output = await withTimeout(
      provider.generateResponse({
        message: input.message,
        systemPrompt: ADMIN_ASSISTANT_SYSTEM_PROMPT,
        registry,
        context: { dataset, summary },
        maxToolCalls: config.maxToolCalls
      }),
      config.timeoutMs
    );
  } catch (error) {
    const status: AdminAssistantQueryStatus =
      error instanceof TimeoutError ? 'timeout' : 'provider_error';
    return {
      ...baseResponse(config, now, provider.name),
      status,
      answer: [
        {
          kind: 'data_unavailable',
          title:
            status === 'timeout' ? 'Délai dépassé' : 'Erreur du fournisseur',
          lines: [
            status === 'timeout'
              ? "Le fournisseur n'a pas répondu à temps. Réessaie ou consulte le résumé déterministe."
              : 'Le fournisseur a échoué. Consulte le résumé déterministe.'
          ]
        }
      ],
      limitations: DEFAULT_LIMITATIONS
    };
  }

  const producedData = output.toolInvocations.some(
    (invocation) => invocation.resultCount > 0
  );
  const status: AdminAssistantQueryStatus = producedData ? 'ok' : 'no_results';

  return {
    ...baseResponse(config, now, provider.name),
    status,
    answer: output.answer,
    links: output.links,
    toolInvocations: output.toolInvocations,
    provider: { name: provider.name, model: provider.model },
    limitations: [...DEFAULT_LIMITATIONS, ...output.limitations]
  };
};
