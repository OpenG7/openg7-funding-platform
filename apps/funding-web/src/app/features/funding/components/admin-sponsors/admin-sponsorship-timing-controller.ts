import { signal } from '@angular/core';
import type {
  SponsorshipObligation,
  SponsorshipObligationTiming,
  SponsorshipTimingCommandRequest
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

interface TimingPorts {
  canOwn(): boolean;
  isDestroyed(): boolean;
  newRequestId(): string;
  send(
    request: SponsorshipTimingCommandRequest
  ): Promise<{ obligationId: string; timing: SponsorshipObligationTiming }>;
  changed(): void;
}

function confirmedTiming(
  value: unknown,
  expectedVersion: number
): value is SponsorshipObligationTiming {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const t = value as Record<string, unknown>;
  const days = (n: unknown) =>
    n === null ||
    (Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= 3650);
  const date = (s: unknown) =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString() === s;
  if (
    !Number.isSafeInteger(t.version) ||
    (t.version as number) <= expectedVersion ||
    !days(t.deadlineDays) ||
    !days(t.durationDays) ||
    !(t.originAt === null || date(t.originAt)) ||
    !(t.dueAt === null || date(t.dueAt)) ||
    typeof t.overdue !== 'boolean' ||
    !['activation', 'owner_recorded', null].includes(
      t.originProvenance as string | null
    ) ||
    (t.originAt === null) !== (t.originProvenance === null) ||
    ![
      'not_required',
      'unsupported',
      'awaiting_observation',
      'awaiting_review',
      'restart_required',
      'attested'
    ].includes(t.durationState as string)
  )
    return false;
  if (t.startObservation === null) return true;
  if (
    !t.startObservation ||
    typeof t.startObservation !== 'object' ||
    Array.isArray(t.startObservation)
  )
    return false;
  const start = t.startObservation as Record<string, unknown>;
  return (
    typeof start.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      start.id
    ) &&
    date(start.observedAt) &&
    date(start.earliestCompletionAt)
  );
}
/** Owner statements are captured once; unknown results retain their exact command. */
export class AdminSponsorshipTimingController {
  readonly obligation = signal<SponsorshipObligation | null>(null);
  readonly busy = signal(false);
  readonly pending = signal<SponsorshipTimingCommandRequest | null>(null);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly origin = signal('');
  readonly evidence = signal('');
  readonly reason = signal('');
  readonly confirmation = signal('');
  readonly continuity = signal(false);
  private generation = 0;
  private readonly captured = new Map<
    string,
    SponsorshipTimingCommandRequest
  >();
  constructor(private readonly ports: TimingPorts) {}
  select(obligation: SponsorshipObligation): void {
    if (this.obligation()?.id !== obligation.id) {
      this.generation++;
      this.busy.set(false);
      this.pending.set(this.captured.get(obligation.id) ?? null);
      this.origin.set('');
      this.evidence.set('');
      this.reason.set('');
      this.confirmation.set('');
      this.continuity.set(false);
      this.saved.set(false);
      this.error.set('');
    }
    const current = this.obligation();
    if (
      !current ||
      current.id !== obligation.id ||
      ((obligation.timing?.version ?? 0) >= (current.timing?.version ?? 0) &&
        obligation.version >= current.version)
    )
      this.obligation.set(obligation);
  }
  async submit(kind: SponsorshipTimingCommandRequest['kind']): Promise<void> {
    if (
      !this.ports.canOwn() ||
      this.ports.isDestroyed() ||
      this.busy() ||
      this.pending()
    )
      return;
    const o = this.obligation();
    const timing = o?.timing;
    const text = (value: string) =>
      value.trim().length > 0 && value.trim().length <= 2000;
    if (
      !o ||
      !timing ||
      timing.durationState === 'attested' ||
      !['pending', 'blocked'].includes(o.state) ||
      this.confirmation().trim() !== o.id ||
      !text(this.reason())
    ) {
      this.error.set('invalid');
      return;
    }
    let originAt: string | undefined;
    if (kind === 'origin') {
      const raw = this.origin();
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ||
        !Number.isFinite(Date.parse(raw + ':00Z')) ||
        timing.originAt ||
        !text(this.evidence())
      ) {
        this.error.set('invalid');
        return;
      }
      originAt = new Date(raw + ':00Z').toISOString();
      if (originAt.slice(0, 16) !== raw) {
        this.error.set('invalid');
        return;
      }
    }
    if (
      kind !== 'origin' &&
      (o.channel !== 'website' ||
        o.target !== 'openg7' ||
        timing.durationDays === null)
    ) {
      this.error.set('invalid');
      return;
    }
    if (
      kind === 'duration' &&
      (!timing.startObservation || !this.continuity() || !text(this.evidence()))
    ) {
      this.error.set('invalid');
      return;
    }
    if (kind === 'duration' && timing.durationState === 'restart_required') {
      this.error.set('sourceChanged');
      return;
    }
    const request: SponsorshipTimingCommandRequest = {
      requestId: this.ports.newRequestId(),
      obligationId: o.id,
      expectedVersion: timing.version,
      confirmation: o.id,
      reason: this.reason().trim(),
      kind,
      ...(originAt
        ? { originAt, evidenceReference: this.evidence().trim() }
        : {}),
      ...(kind === 'duration'
        ? {
            startObservationId: timing.startObservation!.id,
            evidenceReference: this.evidence().trim(),
            continuityConfirmed: true as const
          }
        : {})
    };
    this.captured.set(o.id, request);
    this.pending.set(request);
    await this.retry();
  }
  async retry(): Promise<void> {
    const request = this.pending();
    if (
      !request ||
      this.busy() ||
      !this.ports.canOwn() ||
      this.ports.isDestroyed()
    )
      return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    this.saved.set(false);
    const current = () =>
      !this.ports.isDestroyed() &&
      generation === this.generation &&
      this.obligation()?.id === request.obligationId;
    try {
      const result = await this.ports.send(request);
      if (!current()) return;
      if (
        result.obligationId !== request.obligationId ||
        !confirmedTiming(result.timing, request.expectedVersion)
      )
        throw new Error('Unconfirmed timing result.');
      this.captured.delete(request.obligationId);
      this.pending.set(null);
      this.obligation.update((o) =>
        o && (o.timing?.version ?? 0) < result.timing.version
          ? { ...o, timing: result.timing }
          : o
      );
      this.saved.set(true);
      this.confirmation.set('');
      this.reason.set('');
      this.evidence.set('');
      this.continuity.set(false);
      this.ports.changed();
    } catch (error) {
      if (!current()) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      const code =
        error instanceof AdminDashboardRequestError ? error.code : undefined;
      const definite =
        [400, 403, 404].includes(status) ||
        (status === 409 &&
          !!code &&
          [
            'TIMING_VERSION_CONFLICT',
            'TIMING_ORIGIN_ALREADY_RECORDED',
            'TIMING_DEADLINE_NOT_REQUIRED',
            'DURATION_NOT_ELAPSED',
            'DURATION_SOURCE_CHANGED',
            'DURATION_OBSERVATION_NOT_FOUND',
            'DURATION_PREVIOUS_PASSAGE_OPEN',
            'DURATION_PERIOD_OVERLAP',
            'SOURCE_NOT_ELIGIBLE',
            'SOURCE_COMMITMENT_CHANGED',
            'MEDIA_CHANGED',
            'MEDIA_UNAVAILABLE',
            'REQUIRED_ELEMENTS_MISSING',
            'COMMITMENT_ALREADY_COMPLETED',
            'COMMITMENT_NOT_ACTIVE',
            'COMMITMENT_BLOCKED',
            'MEDIA_USAGE_CONFIRMATION_REQUIRED',
            'MODERATION_REVIEW_REQUIRED'
          ].includes(code));
      if (definite) {
        this.captured.delete(request.obligationId);
        this.pending.set(null);
      }
      this.error.set(
        code === 'DURATION_PREVIOUS_PASSAGE_OPEN'
          ? 'previousPassageOpen'
          : code === 'DURATION_PERIOD_OVERLAP'
            ? 'periodOverlap'
            : code === 'DURATION_NOT_ELAPSED'
              ? 'tooEarly'
              : [
                    'DURATION_SOURCE_CHANGED',
                    'DURATION_OBSERVATION_NOT_FOUND',
                    'MEDIA_CHANGED'
                  ].includes(code ?? '')
                ? 'sourceChanged'
                : status === 409 && definite
                  ? 'conflict'
                  : status === 400
                    ? 'invalid'
                    : status === 403
                      ? 'ownerOnly'
                      : status === 404
                        ? 'notFound'
                        : status === 401
                          ? 'unauthorized'
                          : 'uncertain'
      );
    } finally {
      if (current()) this.busy.set(false);
    }
  }
}
