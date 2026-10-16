import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  MODERATION_REASONS,
  type ModerationLevel,
  type ModerationSubject
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingModerationService } from '../../services/funding-moderation.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';

/** Subject-scoped contextual decisions and independent review, separate from sending/visibility. */
@Component({
  selector: 'openg7-funding-moderation-actions',
  standalone: true,
  imports: [TranslatePipe, AdminAutomaticPreparationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-moderation-actions.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './funding-moderation-actions.component.css'
  ]
})
export class FundingModerationActionsComponent {
  readonly subject = input.required<ModerationSubject>();
  readonly automaticFor = input<string | null>(null);
  readonly headingLevel = input<2 | 3>(3);
  readonly disabled = input(false);
  readonly changed = output<void>();
  private readonly admin = inject(FundingAdminService);
  private readonly moderation = inject(FundingModerationService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly i18n = inject(FundingI18nService);
  readonly canReview = computed(() => this.admin.identity()?.role !== 'reader');
  readonly canAssign = computed(() => this.admin.identity()?.role === 'owner');
  readonly level = signal<ModerationLevel>('N1');
  readonly levels = computed<ModerationLevel[]>(() =>
    this.subject().type === 'sponsorship'
      ? ['N0', 'N1', 'N2', 'N4', 'N5']
      : ['N0', 'N1', 'N2', 'N3', 'N5']
  );
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly caseState = signal('');
  readonly currentDecisionId = signal<string | null>(null);
  readonly decisions = signal<
    Awaited<ReturnType<FundingAdminService['moderationDecisions']>>['items']
  >([]);
  readonly reconsiderations = signal<
    Awaited<
      ReturnType<FundingAdminService['moderationReconsiderations']>
    >['items']
  >([]);
  readonly members = signal<
    Awaited<ReturnType<FundingAdminService['accessAccounts']>>['accounts']
  >([]);
  readonly assignedTo = signal<string | null>(null);
  readonly assignmentDraft = signal('');
  readonly assignmentState = signal<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  private generation = 0;
  private readonly contextKey = computed(
    () => `${this.subject().type}:${this.subject().id}`
  );
  private independentAttempt: { id: string; requestId: string } | null = null;
  constructor() {
    effect(() => {
      this.contextKey();
      this.canReview();
      this.canAssign();
      this.generation++;
      this.busy.set(false);
      this.decisions.set([]);
      this.reconsiderations.set([]);
      this.members.set([]);
      this.assignedTo.set(null);
      this.assignmentDraft.set('');
      this.assignmentState.set('idle');
      this.caseState.set('');
      this.currentDecisionId.set(null);
      this.notice.set('');
      this.level.set('N1');
      this.independentAttempt = null;
    });
    inject(DestroyRef).onDestroy(() => this.generation++);
  }
  setLevel(event: Event): void {
    const level = (event.target as HTMLSelectElement).value as ModerationLevel;
    if (this.levels().includes(level)) this.level.set(level);
  }
  reason(
    code: import('@openg7/funding-core').ModerationReasonCode | null
  ): string {
    return (
      MODERATION_REASONS.find((reason) => reason.code === code)?.label[
        this.i18n.currentLanguage() === 'en' ? 'en' : 'fr'
      ] ?? ''
    );
  }
  historyOpened(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) void this.loadHistory();
  }
  async loadHistory(): Promise<void> {
    const subject = this.subject();
    const generation = this.generation;
    if (!this.canReview()) return;
    try {
      const [cases, decisions, reconsiderations] = await Promise.all([
        this.admin.moderationCases(subject),
        this.admin.moderationDecisions(subject),
        this.admin.moderationReconsiderations(subject)
      ]);
      if (generation !== this.generation) return;
      this.decisions.set(decisions.items);
      this.reconsiderations.set(reconsiderations.items);
      this.caseState.set(cases.items[0]?.state ?? 'unreviewed');
      this.currentDecisionId.set(cases.items[0]?.currentDecisionId ?? null);
      this.assignedTo.set(cases.items[0]?.assignedTo ?? null);
      this.assignmentDraft.set(this.assignedTo() ?? '');
      if (this.canAssign()) {
        this.assignmentState.set('loading');
        try {
          const accounts = await this.admin.accessAccounts();
          if (generation !== this.generation) return;
          this.members.set(
            accounts.accounts.filter(
              (account) => !account.disabled && account.role !== 'reader'
            )
          );
          this.assignmentState.set('ready');
        } catch {
          if (generation === this.generation) this.assignmentState.set('error');
        }
      }
    } catch {
      if (generation === this.generation) {
        this.decisions.set([]);
        this.reconsiderations.set([]);
        this.notice.set('admin.moderation.failed');
      }
    }
  }
  async decide(): Promise<void> {
    if (this.busy() || this.disabled() || !this.canReview()) return;
    const subject = this.subject();
    const generation = this.generation;
    this.busy.set(true);
    try {
      const decision = await this.moderation.requestDecision(
        subject,
        this.level()
      );
      if (
        !decision ||
        generation !== this.generation ||
        this.disabled() ||
        !this.canReview()
      )
        return;
      const result = await this.admin.moderationDecision(subject, decision);
      if (generation !== this.generation) return;
      this.notice.set(
        result.decision.state === 'pending_independent_review'
          ? 'admin.moderation.independentReview'
          : 'admin.moderation.saved'
      );
      this.changed.emit();
      await this.loadHistory();
    } catch (error) {
      if (generation === this.generation) this.notice.set(this.errorKey(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async independent(id: string): Promise<void> {
    const generation = this.generation;
    if (
      this.busy() ||
      this.disabled() ||
      !this.canReview() ||
      id !== this.currentDecisionId() ||
      !(await this.confirmation.confirm(
        this.i18n.t('admin.moderation.independentConfirm'),
        id
      )) ||
      generation !== this.generation
    )
      return;
    this.busy.set(true);
    if (this.independentAttempt?.id !== id)
      this.independentAttempt = {
        id,
        requestId: globalThis.crypto.randomUUID()
      };
    try {
      await this.admin.moderationIndependentReview(
        id,
        this.independentAttempt.requestId
      );
      if (generation !== this.generation) return;
      this.notice.set('admin.moderation.saved');
      this.changed.emit();
      await this.loadHistory();
    } catch (error) {
      if (generation === this.generation) this.notice.set(this.errorKey(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  async resolveReconsideration(appealId: string): Promise<void> {
    if (
      this.busy() ||
      this.disabled() ||
      !this.canReview() ||
      !this.reconsiderations().some(
        (appeal) => appeal.id === appealId && appeal.state === 'open'
      )
    )
      return;
    const subject = this.subject();
    const generation = this.generation;
    this.busy.set(true);
    try {
      const decision = await this.moderation.requestDecision(
        subject,
        this.level(),
        { requireExplanation: true }
      );
      if (
        !decision ||
        generation !== this.generation ||
        this.disabled() ||
        !this.canReview()
      )
        return;
      const result = await this.admin.resolveModerationReconsideration(
        appealId,
        subject,
        decision
      );
      if (generation !== this.generation) return;
      this.notice.set(
        result.decision.state === 'pending_independent_review'
          ? 'admin.moderation.independentReview'
          : 'admin.moderation.saved'
      );
      this.changed.emit();
      await this.loadHistory();
    } catch (error) {
      if (generation === this.generation) this.notice.set(this.errorKey(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  private errorKey(error: unknown): string {
    if (
      error instanceof Error &&
      error.message === 'MODERATION_INDEPENDENT_IDENTITY_REQUIRED'
    )
      return 'admin.moderation.independentIdentityRequired';
    if (
      error instanceof Error &&
      error.message === 'MODERATION_INDEPENDENT_REVIEW_REQUIRED'
    )
      return 'admin.moderation.independentActorRequired';
    return 'admin.moderation.failed';
  }
  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
  async assign(): Promise<void> {
    const assignedTo = this.assignmentDraft() || null;
    const expectedAssignedTo = this.assignedTo();
    const subject = this.subject();
    const generation = this.generation;
    if (
      !this.canAssign() ||
      this.busy() ||
      this.disabled() ||
      this.assignmentState() !== 'ready' ||
      assignedTo === expectedAssignedTo ||
      (assignedTo &&
        !this.members().some((member) => 'admin:' + member.id === assignedTo))
    )
      return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.moderation.assignmentConfirm'),
        assignedTo
          ? this.members().find((member) => 'admin:' + member.id === assignedTo)
              ?.displayName
          : this.i18n.t('admin.moderation.unassigned')
      )) ||
      generation !== this.generation ||
      !this.canAssign() ||
      this.busy() ||
      this.disabled()
    )
      return;
    this.busy.set(true);
    try {
      await this.admin.assignModeration(
        subject,
        assignedTo,
        expectedAssignedTo
      );
      if (generation !== this.generation) return;
      this.notice.set('admin.moderation.assignmentSaved');
      await this.loadHistory();
    } catch {
      if (generation === this.generation)
        this.notice.set('admin.moderation.failed');
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
}
