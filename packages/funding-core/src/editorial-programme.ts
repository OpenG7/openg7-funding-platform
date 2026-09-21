import type {
  PublicationDelivery,
  PublicationFeed,
  PublicationFeedId
} from './publication-automation.js';

export const EDITORIAL_INTENTS = [
  'concise',
  'neutral',
  'project_first',
  'linkedin'
] as const;
export type EditorialIntent = (typeof EDITORIAL_INTENTS)[number];
export interface EditorialProfile {
  feedId: PublicationFeedId;
  version: number;
  preferences: EditorialIntent[];
  observations: Partial<Record<EditorialIntent, number>>;
}
export interface ProgrammeIssue {
  deliveryId: string;
  codes: string[];
  excludedSponsorIds: string[];
  repair: {
    version: string;
    message: string;
    scheduledAt: string;
    sponsors: { id: string; name: string }[];
    removed: string[];
    added: string[];
  } | null;
}
export interface ProgrammeState {
  generatedAt: string;
  version: string;
  complete: boolean;
  writable: boolean;
  feeds: PublicationFeed[];
  profiles: EditorialProfile[];
  deliveries: PublicationDelivery[];
  issues: ProgrammeIssue[];
  briefing: {
    ready: number;
    scheduled: number;
    blocked: number;
    coveredUntil: string | null;
  };
}
export interface ProgrammeMove {
  id: string;
  version: number;
  scheduledAt: string;
}
export interface ProgrammePlan {
  moves: ProgrammeMove[];
  warnings: {
    code: 'collision' | 'repetition' | 'sponsor_repeat' | 'unplaced';
    ids: string[];
  }[];
  emptySlots: string[];
}

/** Recognised editing intentions only. A sentence cannot grant execution authority. */
export function editorialIntent(value: string): EditorialIntent | null {
  const text = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (EDITORIAL_INTENTS.includes(value as EditorialIntent))
    return value as EditorialIntent;
  if (/^(raccourcis|raccourcir|plus court|shorten|make it shorter)/.test(text))
    return 'concise';
  if (
    /^(moins promotionnel|moins institutionnel|plus neutre|ton neutre|neutral|less promotional)/.test(
      text
    )
  )
    return 'neutral';
  if (
    /^(mets? .*projet|mettre .*projet|projet .*valeur|project first|highlight the project)/.test(
      text
    )
  )
    return 'project_first';
  if (
    /^(propose .*linkedin|version .*linkedin|linkedin|adapt .*linkedin)/.test(
      text
    )
  )
    return 'linkedin';
  return null;
}

/** Extractive transformations: keep names, figures, links and paid disclosures.
 * No model, external service or invented claim. The result still requires review. */
export function editorialVariant(
  message: string,
  intent: EditorialIntent,
  names: string[] = []
): string {
  let paragraphs = message
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim());
  if (intent === 'concise') {
    paragraphs = paragraphs.map((p) => {
      if (/commandite|sponsor(?:ed|ship)|remunere|rémunér|paid/i.test(p))
        return p;
      const sentences = p.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ÿ])/u);
      const omitted = sentences.slice(1).join(' ');
      if (
        /\d|https?:|www\./i.test(omitted) ||
        names.some((n) => omitted.includes(n))
      )
        return p;
      return sentences[0] ?? p;
    });
  }
  if (intent === 'neutral')
    paragraphs = paragraphs.map((p) =>
      p
        .replace(/^Merci à /, 'Partenaire : ')
        .replace(/^Un partenaire engagé : /, 'Partenaire : ')
        .replace(/^Thank you to /, 'Partner: ')
    );
  if (intent === 'project_first') {
    const project = paragraphs.filter(
      (p) =>
        /\b(projet|project|réalisation|achievement)\b/i.test(p) &&
        !/commandite rémunérée|paid sponsorship/i.test(p)
    );
    paragraphs = [
      ...project,
      ...paragraphs.filter((p) => !project.includes(p))
    ];
  }
  if (intent === 'linkedin')
    paragraphs = paragraphs.map((p) =>
      p
        .replace(/^Merci à /, 'Un partenaire engagé : ')
        .replace(/^Thank you to /, 'A committed partner: ')
    );
  const result = paragraphs.join('\n\n');
  return result.length <= 2900 && result.trim() ? result : message;
}

export function applyEditorialPreferences(
  message: string,
  preferences: EditorialIntent[],
  names: string[] = []
): string {
  return preferences.reduce(
    (text, intent) => editorialVariant(text, intent, names),
    message
  );
}

/** Candidate slots come from the server's timezone-aware recurrence policy. */
export function composeProgramme(
  deliveries: PublicationDelivery[],
  slots: string[],
  blockedIds: string[],
  includeApproved = false
): ProgrammePlan {
  const blocked = new Set(blockedIds);
  const movable = deliveries.filter(
    (d) =>
      !blocked.has(d.id) &&
      (d.status === 'draft' || (includeApproved && d.status === 'approved'))
  );
  const moving = new Set(movable.map((d) => d.id));
  const fixed = deliveries.filter(
    (d) =>
      !moving.has(d.id) &&
      ['approved', 'publishing', 'uncertain'].includes(d.status)
  );
  const free = slots.filter(
    (s) =>
      !fixed.some(
        (d) => Math.abs(Date.parse(d.scheduledAt) - Date.parse(s)) < 30 * 60000
      )
  );
  const ordered: PublicationDelivery[] = [];
  const remaining = [...movable].sort(
    (a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)
  );
  while (remaining.length) {
    const previous = ordered.at(-1);
    const index = Math.max(
      0,
      remaining.findIndex(
        (d) =>
          !previous?.sponsors.some((s) =>
            d.sponsors.some((next) => next.id === s.id)
          )
      )
    );
    ordered.push(remaining.splice(index, 1)[0]!);
  }
  const moves = ordered
    .slice(0, free.length)
    .map((d, i) => ({ id: d.id, version: d.version, scheduledAt: free[i]! }));
  const warnings = programmeWarnings(deliveries, moves);
  if (ordered.length > free.length)
    warnings.push({
      code: 'unplaced',
      ids: ordered.slice(free.length).map((d) => d.id)
    });
  return { moves, warnings, emptySlots: free.slice(moves.length) };
}

export function programmeWarnings(
  deliveries: PublicationDelivery[],
  moves: ProgrammeMove[]
): ProgrammePlan['warnings'] {
  const projected = deliveries
    .filter((d) => !['cancelled', 'rejected', 'published'].includes(d.status))
    .map((d) => ({
      ...d,
      scheduledAt:
        moves.find((m) => m.id === d.id)?.scheduledAt ?? d.scheduledAt
    }))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const warnings: ProgrammePlan['warnings'] = [];
  for (let i = 0; i < projected.length; i++) {
    const a = projected[i]!;
    for (let j = i + 1; j < projected.length; j++) {
      const b = projected[j]!;
      if (a.feedId !== b.feedId) continue;
      const distance = Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt);
      if (distance < 30 * 60000)
        warnings.push({ code: 'collision', ids: [a.id, b.id] });
      if (distance < 7 * 86400000 && a.message.trim() === b.message.trim())
        warnings.push({ code: 'repetition', ids: [a.id, b.id] });
      if (
        distance < 3 * 86400000 &&
        a.sponsors.some((s) => b.sponsors.some((t) => t.id === s.id))
      )
        warnings.push({ code: 'sponsor_repeat', ids: [a.id, b.id] });
    }
  }
  return warnings;
}
