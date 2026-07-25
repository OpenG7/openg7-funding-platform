// Admin assistant model provider abstraction.
//
// `AdminAssistantModelProvider` decouples the orchestrator from any single AI
// vendor. Iteration 1 ships two implementations:
//   - the DISABLED provider (null) — the deterministic summary still works;
//   - the MOCK provider — a fully in-process, deterministic "agent" used for
//     tests and demos. It selects read-only tools by keyword, NEVER executes
//     instructions found in the (untrusted) question, and cites tool facts.
//
// A real provider ('live') can be added later by implementing the same
// interface; nothing else in the stack needs to change.

import type {
  AdminAssistantAnswerBlock,
  AdminAssistantAnswerLink,
  AdminAssistantToolInvocationSummary,
  AdminAttentionItem
} from '@openg7/funding-core';

import type { AdminAssistantConfig } from './config.js';
import type {
  AssistantTool,
  ToolContext,
  ToolResult
} from './tool-registry.js';

export interface AdminAssistantModelInput {
  /** The raw admin question. Treated strictly as untrusted data. */
  readonly message: string;
  readonly systemPrompt: string;
  readonly registry: ReadonlyMap<string, AssistantTool>;
  readonly context: ToolContext;
  readonly maxToolCalls: number;
}

export interface AdminAssistantModelOutput {
  readonly answer: readonly AdminAssistantAnswerBlock[];
  readonly links: readonly AdminAssistantAnswerLink[];
  readonly toolInvocations: readonly AdminAssistantToolInvocationSummary[];
  readonly limitations: readonly string[];
}

export interface AdminAssistantModelProvider {
  readonly name: string;
  readonly model: string | null;
  generateResponse(
    input: AdminAssistantModelInput
  ): Promise<AdminAssistantModelOutput>;
}

interface ToolSelection {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}

const REFERENCE_PATTERN = /#?[A-Z]{2,}[-_][A-Z0-9-]{2,}/i;

/**
 * Deterministic keyword router. Reads the question ONLY to pick which
 * read-only tools to run — it never follows instructions in the text.
 */
const selectTools = (
  message: string,
  maxToolCalls: number
): ToolSelection[] => {
  const text = message.toLowerCase();
  const selections: ToolSelection[] = [];
  const add = (selection: ToolSelection): void => {
    if (!selections.some((existing) => existing.tool === selection.tool)) {
      selections.push(selection);
    }
  };

  const mentions = (...needles: readonly string[]): boolean =>
    needles.some((needle) => text.includes(needle));

  if (mentions('pourquoi', 'expliqu', 'explain')) {
    const match = message.match(REFERENCE_PATTERN);
    if (match) {
      add({
        tool: 'explain_sponsorship_state',
        input: { reference: match[0] }
      });
    }
  }
  if (
    mentions('incomplèt', 'incomplet', 'fiche', 'sans compléter', 'information')
  ) {
    add({ tool: 'list_sponsorships_needing_information', input: {} });
  }
  if (mentions('revue', 'révis', 'revis', 'approuv', 'décision', 'valider')) {
    add({ tool: 'list_sponsorships_needing_review', input: {} });
  }
  if (mentions('retard', 'dépass', 'depass', 'late', 'en retard')) {
    add({ tool: 'list_late_publications', input: {} });
  }
  if (mentions('prépar', 'prepar', 'publication', 'publier', 'publica')) {
    add({ tool: 'list_publications_needing_preparation', input: {} });
  }
  if (mentions('courriel', 'email', 'e-mail', 'échou', 'echou', 'mail')) {
    add({ tool: 'list_failed_transactional_emails', input: {} });
  }
  if (
    mentions(
      'montant',
      'financ',
      'brut',
      'net',
      'argent',
      'reçu',
      'recu',
      'somme'
    )
  ) {
    add({ tool: 'get_fund_financial_summary', input: {} });
  }
  if (
    selections.length === 0 ||
    mentions(
      'aujourd',
      'today',
      'attention',
      'résum',
      'resum',
      'dois-je',
      'à faire',
      'a faire',
      'priorit'
    )
  ) {
    add({ tool: 'get_admin_attention_summary', input: {} });
  }

  return selections.slice(0, Math.max(1, maxToolCalls));
};

const runSelectedTools = (
  input: AdminAssistantModelInput,
  selections: readonly ToolSelection[]
): ToolResult[] => {
  const results: ToolResult[] = [];
  for (const selection of selections) {
    const tool = input.registry.get(selection.tool);
    if (!tool) {
      continue;
    }
    try {
      const parsed = tool.parseInput(selection.input);
      results.push(tool.execute(input.context, parsed));
    } catch {
      // A malformed selection is skipped, never surfaced as a fabricated fact.
    }
  }
  return results;
};

const isAttentionItemArray = (value: unknown): value is AdminAttentionItem[] =>
  Array.isArray(value);

const factLinesForResult = (result: ToolResult): string[] => {
  if (result.tool === 'get_admin_attention_summary') {
    const summary = result.data as {
      readonly counts: {
        readonly urgent: number;
        readonly today: number;
        readonly thisWeek: number;
      };
    };
    return [
      `Éléments urgents : ${summary.counts.urgent}.`,
      `À traiter aujourd'hui : ${summary.counts.today}.`,
      `Cette semaine : ${summary.counts.thisWeek}.`
    ];
  }

  if (result.tool === 'get_fund_financial_summary') {
    const financial = result.data as {
      readonly grossPaid: number;
      readonly refunded: number;
      readonly currency: string;
    };
    return [
      `Montant brut payé : ${financial.grossPaid} ${financial.currency}.`,
      `Remboursements : ${financial.refunded} ${financial.currency}.`,
      'Montant net estimé : non calculé (frais Stripe non inclus).'
    ];
  }

  if (result.tool === 'explain_sponsorship_state') {
    const data = result.data as {
      readonly found: boolean;
      readonly reference?: string;
      readonly paymentStatus?: string;
      readonly reviewStatus?: string;
      readonly ficheComplete?: boolean;
      readonly flaggedAs?: readonly string[];
    };
    if (!data.found) {
      return [];
    }
    return [
      `Référence ${data.reference} : paiement ${data.paymentStatus}, revue ${data.reviewStatus}, fiche ${data.ficheComplete ? 'complète' : 'incomplète'}.`,
      `Signalée par : ${data.flaggedAs && data.flaggedAs.length > 0 ? data.flaggedAs.join(', ') : 'aucun détecteur'}.`
    ];
  }

  if (isAttentionItemArray(result.data)) {
    if (result.data.length === 0) {
      return [`Aucun élément détecté (${result.tool}).`];
    }
    return result.data
      .slice(0, 5)
      .map((item) => `${item.title} — ${item.explanation}`);
  }

  return [];
};

const linksForResults = (
  results: readonly ToolResult[]
): AdminAssistantAnswerLink[] => {
  const links: AdminAssistantAnswerLink[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (!isAttentionItemArray(result.data)) {
      continue;
    }
    for (const item of result.data.slice(0, 5)) {
      if (item.adminUrl && !seen.has(item.adminUrl)) {
        seen.add(item.adminUrl);
        links.push({ label: item.title, adminUrl: item.adminUrl });
      }
    }
  }
  return links;
};

class MockAdminAssistantProvider implements AdminAssistantModelProvider {
  readonly name = 'mock';
  readonly model: string | null;

  constructor(model: string | null) {
    this.model = model ?? 'mock-router';
  }

  async generateResponse(
    input: AdminAssistantModelInput
  ): Promise<AdminAssistantModelOutput> {
    const selections = selectTools(input.message, input.maxToolCalls);
    const results = runSelectedTools(input, selections);

    const factLines = results.flatMap(factLinesForResult);
    const producedData = results.some((result) => result.resultCount > 0);

    const answer: AdminAssistantAnswerBlock[] = [];
    answer.push({
      kind: 'facts',
      title: 'Faits (issus des outils)',
      lines:
        factLines.length > 0
          ? factLines
          : ['Aucun dossier ne correspond à cette question pour le moment.']
    });

    answer.push({
      kind: 'interpretation',
      title: 'Interprétation',
      lines: [
        producedData
          ? 'Les éléments ci-dessus sont classés par priorité; traite les urgents en premier.'
          : "Rien d'actionnable n'a été détecté pour cette demande."
      ]
    });

    const firstItem = results
      .flatMap((result) =>
        isAttentionItemArray(result.data) ? result.data : []
      )
      .at(0);
    if (firstItem) {
      answer.push({
        kind: 'recommendation',
        title: 'Recommandation (suggestion, non exécutée)',
        lines: [
          `Suggestion : ${firstItem.suggestedActions[0]?.label ?? 'Ouvrir le dossier concerné'} — ${firstItem.title}.`
        ]
      });
    }

    return {
      answer,
      links: linksForResults(results),
      toolInvocations: results.map(
        (result): AdminAssistantToolInvocationSummary => ({
          tool: result.tool,
          resultCount: result.resultCount
        })
      ),
      limitations: [
        'Réponses fondées uniquement sur des outils en lecture seule.',
        "L'assistant ne peut ni approuver, ni rembourser, ni publier, ni modifier une donnée."
      ]
    };
  }
}

/**
 * Resolve the active provider from configuration. Returns null when the
 * assistant is disabled or no usable provider is configured — the caller then
 * returns the appropriate `assistant_disabled` / `provider_not_configured`
 * response without invoking any model.
 */
export const resolveAdminAssistantProvider = (
  config: AdminAssistantConfig
): AdminAssistantModelProvider | null => {
  if (!config.enabled || !config.providerConfigured) {
    return null;
  }
  if (config.provider === 'mock') {
    return new MockAdminAssistantProvider(config.model);
  }
  return null;
};
