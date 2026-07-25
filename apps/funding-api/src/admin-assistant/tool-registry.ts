// Closed registry of READ-ONLY tools for the admin assistant.
//
// Every tool operates over an already-loaded, deterministic dataset — the
// model can never emit SQL, reach the network, or trigger a write. Each tool
// declares a strict input schema, a result limit and a data classification.
// Returned data is minimised (references/ids, never raw names/emails/secrets).

import type {
  AdminAssistantSummary,
  AdminAttentionItem
} from '@openg7/funding-core';

import {
  buildAttentionItems,
  buildFinancialSummary,
  type AttentionDataset
} from './attention.service.js';

export type ToolDataClassification = 'operational' | 'financial' | 'aggregate';

export interface ToolResult {
  readonly tool: string;
  readonly dataClassification: ToolDataClassification;
  readonly resultCount: number;
  readonly truncated: boolean;
  readonly data: unknown;
}

export interface ToolContext {
  readonly dataset: AttentionDataset;
  readonly summary: AdminAssistantSummary;
}

export interface AssistantTool {
  readonly name: string;
  readonly description: string;
  readonly dataClassification: ToolDataClassification;
  readonly resultLimit: number;
  parseInput(input: unknown): Record<string, unknown>;
  execute(context: ToolContext, input: Record<string, unknown>): ToolResult;
}

const MAX_REFERENCE_LENGTH = 64;

const asObject = (input: unknown): Record<string, unknown> => {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AssistantToolInputError('Tool input must be an object.');
  }
  return input as Record<string, unknown>;
};

export class AssistantToolInputError extends Error {}

const rejectUnknownKeys = (
  input: Record<string, unknown>,
  allowed: readonly string[]
): void => {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new AssistantToolInputError(`Unknown tool argument "${key}".`);
    }
  }
};

const parseLimit = (
  input: Record<string, unknown>,
  fallback: number
): number => {
  const value = input.limit;
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AssistantToolInputError('"limit" must be a positive integer.');
  }
  return Math.min(value, fallback);
};

const itemsOfType = (
  context: ToolContext,
  type: AdminAttentionItem['type']
): AdminAttentionItem[] =>
  buildAttentionItems(context.dataset).filter((item) => item.type === type);

const capItems = (
  items: readonly AdminAttentionItem[],
  limit: number
): {
  readonly data: readonly AdminAttentionItem[];
  readonly truncated: boolean;
} => {
  const truncated = items.length > limit;
  return { data: items.slice(0, limit), truncated };
};

const listTool = (
  name: string,
  description: string,
  type: AdminAttentionItem['type'],
  resultLimit: number,
  classification: ToolDataClassification = 'operational'
): AssistantTool => ({
  name,
  description,
  dataClassification: classification,
  resultLimit,
  parseInput(input) {
    const parsed = asObject(input);
    rejectUnknownKeys(parsed, ['limit']);
    return { limit: parseLimit(parsed, resultLimit) };
  },
  execute(context, input) {
    const limit = typeof input.limit === 'number' ? input.limit : resultLimit;
    const { data, truncated } = capItems(itemsOfType(context, type), limit);
    return {
      tool: name,
      dataClassification: classification,
      resultCount: data.length,
      truncated,
      data
    };
  }
});

const summaryTool: AssistantTool = {
  name: 'get_admin_attention_summary',
  description:
    'Retourne le résumé administratif global : compteurs par priorité, ' +
    'compteurs commandites/publications/courriels, résumé financier prudent ' +
    "et les éléments d'attention. Données agrégées, aucune donnée privée.",
  dataClassification: 'aggregate',
  resultLimit: 1,
  parseInput(input) {
    const parsed = asObject(input);
    rejectUnknownKeys(parsed, []);
    return {};
  },
  execute(context) {
    return {
      tool: this.name,
      dataClassification: this.dataClassification,
      resultCount: 1,
      truncated: false,
      data: context.summary
    };
  }
};

const financialTool: AssistantTool = {
  name: 'get_fund_financial_summary',
  description:
    'Retourne le résumé financier prudent : montant brut payé, frais connus, ' +
    'remboursements, montant net estimé et limitations. Ne présente jamais un ' +
    'chiffre comme trésorerie disponible.',
  dataClassification: 'financial',
  resultLimit: 1,
  parseInput(input) {
    const parsed = asObject(input);
    rejectUnknownKeys(parsed, []);
    return {};
  },
  execute(context) {
    return {
      tool: this.name,
      dataClassification: this.dataClassification,
      resultCount: 1,
      truncated: false,
      data: buildFinancialSummary(context.dataset)
    };
  }
};

const explainSponsorshipTool: AssistantTool = {
  name: 'explain_sponsorship_state',
  description:
    "Explique l'état opérationnel d'une commandite identifiée par sa " +
    'référence publique ou son identifiant. Retourne uniquement des données ' +
    'minimisées (référence, montant, statuts), jamais de nom ni de courriel.',
  dataClassification: 'operational',
  resultLimit: 1,
  parseInput(input) {
    const parsed = asObject(input);
    rejectUnknownKeys(parsed, ['reference']);
    const reference = parsed.reference;
    if (typeof reference !== 'string' || reference.trim().length === 0) {
      throw new AssistantToolInputError('"reference" is required.');
    }
    if (reference.length > MAX_REFERENCE_LENGTH) {
      throw new AssistantToolInputError('"reference" is too long.');
    }
    return { reference: reference.trim() };
  },
  execute(context, input) {
    const reference = String(input.reference ?? '');
    const needle = reference.replace(/^#/, '').toLowerCase();
    const record = context.dataset.sponsorships.find(
      (candidate) =>
        candidate.publicReference?.toLowerCase() === reference.toLowerCase() ||
        candidate.contributionId.toLowerCase() === needle ||
        candidate.contributionId.toLowerCase().startsWith(needle)
    );

    if (!record) {
      return {
        tool: this.name,
        dataClassification: this.dataClassification,
        resultCount: 0,
        truncated: false,
        data: { found: false, reference }
      };
    }

    const flaggedAs = buildAttentionItems(context.dataset)
      .filter((item) => item.sponsorshipId === record.contributionId)
      .map((item) => item.type);

    return {
      tool: this.name,
      dataClassification: this.dataClassification,
      resultCount: 1,
      truncated: false,
      data: {
        found: true,
        reference:
          record.publicReference ?? `#${record.contributionId.slice(0, 8)}`,
        amount: record.amount,
        currency: record.currency,
        paymentStatus: record.paymentStatus,
        refundStatus: record.refundStatus,
        reviewStatus: record.reviewStatus,
        feedStatus: record.feedStatus,
        ficheComplete:
          record.detailsSubmittedAt !== null &&
          record.hasCompanyName &&
          record.hasContactEmail,
        flaggedAs
      }
    };
  }
};

/**
 * The complete, closed set of tools the assistant may call. Any name not in
 * this registry is rejected by the orchestrator.
 */
export const createAssistantToolRegistry = (
  perToolLimit = 25
): ReadonlyMap<string, AssistantTool> => {
  const tools: readonly AssistantTool[] = [
    summaryTool,
    financialTool,
    explainSponsorshipTool,
    listTool(
      'list_sponsorships_needing_information',
      'Liste les commandites payées dont la fiche est incomplète.',
      'sponsorship_needs_info',
      perToolLimit
    ),
    listTool(
      'list_sponsorships_needing_review',
      'Liste les commandites complètes en attente de décision administrative.',
      'sponsorship_needs_review',
      perToolLimit
    ),
    listTool(
      'list_publications_needing_preparation',
      'Liste les commandites approuvées dont les publications ne sont pas préparées.',
      'publication_needs_preparation',
      perToolLimit
    ),
    listTool(
      'list_late_publications',
      'Liste les créneaux et lots de publication dépassés.',
      'publication_late',
      perToolLimit
    ),
    listTool(
      'list_failed_transactional_emails',
      'Liste les courriels transactionnels en échec (sans secret ni adresse complète).',
      'email_delivery_failed',
      perToolLimit
    )
  ];

  return new Map(tools.map((tool) => [tool.name, tool]));
};

export const assistantToolNames = (
  registry: ReadonlyMap<string, AssistantTool>
): readonly string[] => [...registry.keys()];
