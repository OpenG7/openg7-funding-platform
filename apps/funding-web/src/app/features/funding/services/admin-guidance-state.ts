import { ADMIN_GUIDANCE_PAGES } from '../components/admin-guidance/admin-guidance-pages.js';
import { ADMIN_WORKFLOW_GUIDE_JOURNEYS } from '../components/admin-guidance/admin-workflow-guide.catalog.js';

export interface AdminGuidanceBookmark {
  pageId: string;
  step: number;
  paused: boolean;
}

export interface AdminGuidanceSnapshot {
  enabled: boolean;
  bookmark: AdminGuidanceBookmark | null;
  mode?: 'automatic' | 'workflows';
  payment?: { contributionId: string; paused: boolean };
  workflow?: { journeyId: string; step: number; paused: boolean };
}

type GuidanceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function emptySnapshot(): AdminGuidanceSnapshot {
  return { enabled: false, bookmark: null };
}

export function guidanceContributionId(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
    ? value.toLowerCase()
    : null;
}

/** A stale query from another workspace must not select its dossier as the current one. */
export function guidancePaymentContext(
  pageId: string | undefined,
  contribution: unknown,
  sponsorship: unknown
): string | null {
  const contributionId = guidanceContributionId(contribution);
  const sponsorshipId = guidanceContributionId(sponsorship);
  if (pageId === 'sponsors' || pageId === 'assistant') return sponsorshipId;
  if (pageId === 'contributions' || pageId === 'invoices')
    return contributionId;
  if (contributionId && sponsorshipId && contributionId !== sponsorshipId)
    return null;
  return contributionId ?? sponsorshipId;
}

function cleanSnapshot(value: unknown): AdminGuidanceSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot['enabled'] !== 'boolean') return null;
  const payment = snapshot['payment'];
  let paymentBookmark: AdminGuidanceSnapshot['payment'];
  if (payment !== undefined) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment))
      return null;
    const candidate = payment as Record<string, unknown>;
    const contributionId = guidanceContributionId(candidate['contributionId']);
    if (!contributionId || typeof candidate['paused'] !== 'boolean')
      return null;
    paymentBookmark = { contributionId, paused: candidate['paused'] };
  }
  if (
    snapshot['mode'] !== undefined &&
    snapshot['mode'] !== 'payment' &&
    snapshot['mode'] !== 'automatic' &&
    snapshot['mode'] !== 'workflows'
  )
    return null;
  let workflow: AdminGuidanceSnapshot['workflow'];
  if (snapshot['workflow'] !== undefined) {
    const candidate = snapshot['workflow'];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return null;
    const value = candidate as Record<string, unknown>;
    const definition = ADMIN_WORKFLOW_GUIDE_JOURNEYS.find(
      (entry) => entry.id === value['journeyId']
    );
    const step = value['step'];
    if (
      !definition ||
      typeof step !== 'number' ||
      !Number.isInteger(step) ||
      step < 0 ||
      step >= definition.steps.length ||
      typeof value['paused'] !== 'boolean'
    )
      return null;
    workflow = { journeyId: definition.id, step, paused: value['paused'] };
  }
  const journey = {
    ...(snapshot['mode'] === 'automatic' ? { mode: 'automatic' as const } : {}),
    ...(snapshot['mode'] === 'workflows' ? { mode: 'workflows' as const } : {}),
    ...(workflow ? { workflow } : {}),
    ...(paymentBookmark ? { payment: paymentBookmark } : {})
  };
  // Retain preparation context without reopening the retired payment surface.
  const enabled = snapshot['mode'] === 'payment' ? false : snapshot['enabled'];
  const bookmark = snapshot['bookmark'];
  if (bookmark === null) {
    return { enabled, bookmark: null, ...journey };
  }
  if (!bookmark || typeof bookmark !== 'object' || Array.isArray(bookmark)) {
    return null;
  }
  const candidate = bookmark as Record<string, unknown>;
  const page = ADMIN_GUIDANCE_PAGES.find(
    (entry) => entry.id === candidate['pageId']
  );
  const step = candidate['step'];
  if (
    !page ||
    typeof step !== 'number' ||
    !Number.isInteger(step) ||
    step < 0 ||
    step >= page.steps.length ||
    typeof candidate['paused'] !== 'boolean'
  ) {
    return null;
  }
  return {
    enabled,
    bookmark: { pageId: page.id, step, paused: candidate['paused'] },
    ...journey
  };
}

/** Stores reading cues and an optional payment UUID, never dossier facts or completed actions. */
export class AdminGuidanceState {
  private readonly memory = new Map<
    string,
    { snapshot: AdminGuidanceSnapshot; available: boolean }
  >();
  private available = false;

  constructor(private readonly storage: () => GuidanceStorage | null) {}

  get storageAvailable(): boolean {
    return this.available;
  }

  load(accountId: string): AdminGuidanceSnapshot {
    if (!accountId.trim()) return emptySnapshot();
    const retained = this.memory.get(accountId);
    if (retained) {
      this.available = retained.available;
      return cleanSnapshot(retained.snapshot) ?? emptySnapshot();
    }
    let snapshot = emptySnapshot();
    const storage = this.resolveStorage();
    if (storage) {
      try {
        const serialized = storage.getItem(this.key(accountId));
        this.available = true;
        if (serialized !== null) {
          try {
            snapshot = cleanSnapshot(JSON.parse(serialized)) ?? emptySnapshot();
          } catch {
            snapshot = emptySnapshot();
          }
        }
      } catch {
        this.available = false;
      }
    }
    this.memory.set(accountId, { snapshot, available: this.available });
    return cleanSnapshot(snapshot) ?? emptySnapshot();
  }

  save(accountId: string, snapshot: AdminGuidanceSnapshot): boolean {
    const cleaned = cleanSnapshot(snapshot);
    if (!accountId.trim() || !cleaned) return false;
    const retained = { snapshot: cleaned, available: false };
    this.memory.set(accountId, retained);
    const storage = this.resolveStorage();
    if (!storage) return false;
    try {
      storage.setItem(this.key(accountId), JSON.stringify(cleaned));
      this.available = true;
      retained.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  clear(accountId: string): boolean {
    if (!accountId.trim()) return false;
    const retained = { snapshot: emptySnapshot(), available: false };
    this.memory.set(accountId, retained);
    const storage = this.resolveStorage();
    if (!storage) return false;
    try {
      storage.removeItem(this.key(accountId));
      this.available = true;
      retained.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  private key(accountId: string): string {
    return `og7-admin-guidance:v1:${accountId}`;
  }

  private resolveStorage(): GuidanceStorage | null {
    try {
      const storage = this.storage();
      if (!storage) this.available = false;
      return storage;
    } catch {
      this.available = false;
      return null;
    }
  }
}
