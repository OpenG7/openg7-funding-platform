import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  afterNextRender,
  afterRenderEffect
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  PREPARATION_SOURCE_MAX_LENGTH,
  normalizePreparationAssistanceDraft,
  type SponsorshipOfferSnapshot
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { revealControllerFocus } from '../admin-controller/admin-controller-navigation.js';

import {
  PreparationAssistanceController,
  type PreparationAssistanceSelection
} from './preparation-assistance.controller.js';
import { PreparationAssistanceProposalTableComponent } from './preparation-assistance-proposal-table.component.js';
import { PreparationReturnService } from './preparation-return.service.js';

/** Historical agreement assistance. Extraction never checks or approves a business control. */
@Component({
  selector: 'openg7-preparation-assistance-review',
  standalone: true,
  imports: [AdminIconComponent, PreparationAssistanceProposalTableComponent],
  templateUrl: './preparation-assistance-review.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './preparation-assistance-review.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreparationAssistanceReviewComponent {
  readonly contributionId = input.required<string>();
  readonly commitmentVersion = input.required<number>();
  readonly offer = input<SponsorshipOfferSnapshot | null>(null);
  readonly reason = input('');
  readonly selected = input(false);
  readonly readyToConfirm = input(false);
  readonly formDirty = input(false);
  readonly disabled = input(false);
  readonly selectionChange = output<PreparationAssistanceSelection>();
  readonly useForm = output<PreparationAssistanceSelection>();
  readonly documentClause = output<{
    readonly selection: PreparationAssistanceSelection;
    readonly itemId: string;
  }>();
  readonly reasonChange = output<string>();
  readonly reasonRequested = output<void>();
  readonly manual = output<void>();
  readonly invalidated = output<void>();
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
  readonly maxSourceLength = PREPARATION_SOURCE_MAX_LENGTH;
  readonly sourceEditing = signal(false);
  readonly returnNavigation = inject(PreparationReturnService);
  private readonly admin = inject(FundingAdminService);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment);
  private focusedNavigation = '';
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroy = inject(DestroyRef);
  readonly c = new PreparationAssistanceController({
    admin: this.admin,
    identity: () =>
      `${this.admin.sessionGeneration()}:${this.admin.identity()?.id ?? 'token'}:${this.admin.identity()?.sessionId ?? 'token'}:${this.admin.identity()?.role ?? 'owner'}`,
    permitted: () =>
      this.admin.hasValidAdminSession() &&
      (!this.admin.identity() || this.admin.identity()?.role === 'owner'),
    visible: () => this.document.visibilityState !== 'hidden',
    changed: (selection) => this.selectionChange.emit(selection),
    invalidated: () => this.invalidated.emit(),
    unauthorized: () => {
      this.admin.clearAdminSession();
      void this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
      });
    }
  });
  readonly locked = computed(
    () => this.disabled() || this.c.loading() || this.c.busy()
  );
  readonly processing = computed(
    () => !this.c.error() && this.c.data()?.run?.state === 'processing'
  );
  readonly sourceEditorVisible = computed(
    () =>
      !this.c.data()?.source ||
      this.sourceEditing() ||
      this.c.sourceDirty() ||
      this.c.sourceConflict()
  );
  readonly analysisHint = computed(() => {
    if (this.c.sourceDirty()) return 'saveSourceFirst';
    if (this.c.reviewDirty()) return 'saveReviewFirst';
    const state = this.c.data();
    if (!state?.source) return 'sourceRequired';
    if (state.run?.state === 'queued' || state.run?.state === 'processing')
      return 'analysisRunning';
    if (!state.capabilities.canRun) return 'analysisUnavailable';
    return '';
  });
  private formDraft = '';

  constructor() {
    afterRenderEffect(() => {
      const fragment = this.fragment(),
        ready = this.languageReady(),
        state = this.c.data();
      if (!this.browser) return;
      if (
        fragment !== 'dossier-assistance-source' &&
        fragment !== 'dossier-assistance-review'
      ) {
        this.focusedNavigation = '';
        return;
      }
      const key = this.contributionId() + ':' + fragment;
      if (!ready || !state || this.focusedNavigation === key) return;
      const target = this.element.nativeElement.querySelector<HTMLElement>(
        '#' + fragment
      );
      if (!target) return;
      this.focusedNavigation = key;
      if (target instanceof HTMLDetailsElement) target.open = true;
      revealControllerFocus(
        target.querySelector<HTMLElement>('summary') ?? target
      );
    });
    effect((onCleanup) => {
      const language = this.i18n.currentLanguage();
      let current = true;
      onCleanup(() => (current = false));
      this.languageReady.set(false);
      this.languageError.set(false);
      const locale =
        language === 'en'
          ? import('../../../../../assets/i18n/admin-preparation-assistance.en.json')
          : import('../../../../../assets/i18n/admin-preparation-assistance.fr-CA.json');
      void locale
        .then(({ default: translations }) => {
          if (!current || this.destroy.destroyed) return;
          this.i18n.mergeTranslations(language, {
            admin: { preparationAssistance: translations }
          });
          this.languageReady.set(true);
        })
        .catch(() => {
          if (current && !this.destroy.destroyed) this.languageError.set(true);
        });
    });
    effect(() => {
      const id = this.contributionId();
      const key = `${this.commitmentVersion()}:${this.admin.dataRevision()}`;
      this.admin.sessionGeneration();
      this.admin.identity();
      if (!this.browser) return;
      untracked(() => {
        this.sourceEditing.set(false);
        this.c.select(id, key);
      });
    });
    effect(() => {
      const offer = this.offer(),
        reason = this.reason();
      untracked(() => {
        const key = JSON.stringify({ offer, reason });
        const review = this.c.data()?.run?.review;
        if (
          this.formDraft &&
          this.formDraft !== key &&
          key !==
            JSON.stringify({
              offer: review?.offer ?? null,
              reason: review?.reason ?? ''
            })
        )
          this.c.markReviewDirty();
        this.formDraft = key;
      });
    });
    this.destroy.onDestroy(() => this.c.dispose());
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.preparationAssistance.' + key, params);
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  editSource(): void {
    this.sourceEditing.set(true);
    afterNextRender(
      () => {
        const target = this.element.nativeElement.querySelector<HTMLElement>(
          '[data-og7="assistance-source-text"]'
        );
        if (target) revealControllerFocus(target);
      },
      { injector: this.injector }
    );
  }
  async saveSource(): Promise<void> {
    const id = this.contributionId();
    const session = this.admin.sessionGeneration();
    await this.c.saveSource();
    if (
      !this.destroy.destroyed &&
      this.contributionId() === id &&
      this.admin.sessionGeneration() === session &&
      !this.c.error() &&
      !this.c.sourceDirty()
    ) {
      this.sourceEditing.set(false);
      afterNextRender(
        () => {
          if (
            this.destroy.destroyed ||
            this.contributionId() !== id ||
            this.admin.sessionGeneration() !== session
          )
            return;
          const active = this.document.activeElement;
          if (
            active &&
            active !== this.document.body &&
            !this.element.nativeElement.contains(active)
          )
            return;
          const target =
            this.element.nativeElement.querySelector<HTMLElement>(
              '[data-og7="assistance-run-state"]'
            ) ??
            this.element.nativeElement.querySelector<HTMLElement>(
              '[data-og7="assistance-source-edit"]'
            );
          if (target) revealControllerFocus(target);
        },
        { injector: this.injector }
      );
    }
  }
  async returnToPreparation(): Promise<void> {
    const id = this.contributionId();
    const origin = this.returnNavigation.origin(id);
    if (!origin || this.locked() || this.returnNavigation.returning()) return;
    if (
      origin.kind === 'guide' &&
      (this.c.sourceDirty() || this.c.reviewDirty() || this.formDirty()) &&
      !(await this.confirmation.confirm(this.t('returnUnsaved'), id))
    )
      return;
    if (this.contributionId() === id && !this.locked())
      await this.returnNavigation.returnToOrigin(id);
  }
  documentBenefitClause(itemId: string): void {
    const state = this.c.data();
    const item = state?.run?.suggestion?.items.find(
      (item) => item.id === itemId
    );
    if (
      !state ||
      !item ||
      item.attention === 'unsupported_terms' ||
      state.stale ||
      this.c.reviewConflict() ||
      this.c.sourceConflict() ||
      this.locked() ||
      !state.capabilities.canReview
    )
      return;
    this.documentClause.emit({
      selection: { state, items: this.c.items() },
      itemId
    });
  }
  chooseForm(): void {
    const state = this.c.data();
    if (
      !state?.run?.suggestion ||
      state.stale ||
      this.c.reviewConflict() ||
      this.c.sourceConflict() ||
      this.locked()
    )
      return;
    this.useForm.emit({ state, items: this.c.items() });
  }
  async review(decision: 'save' | 'reject'): Promise<void> {
    const suggestion = this.c.data()?.run?.suggestion;
    if (!suggestion || this.locked()) return;
    if (this.reason().trim().length < 5) {
      this.c.error.set('reviewInvalid');
      this.focusReviewError(true);
      return;
    }
    try {
      const draft = normalizePreparationAssistanceDraft(
        { offer: this.offer(), items: this.c.items(), reason: this.reason() },
        suggestion
      );
      await this.c.review(decision, draft);
    } catch {
      this.c.error.set('reviewInvalid');
      this.focusReviewError(false);
    }
  }
  private focusReviewError(reason: boolean): void {
    if (reason) {
      this.reasonRequested.emit();
      return;
    }
    afterNextRender(
      () => {
        const target = this.element.nativeElement.querySelector<HTMLElement>(
          '[data-og7="assistance-clause-disposition"]'
        );
        if (target) revealControllerFocus(target);
      },
      { injector: this.injector }
    );
  }
  resetReview(): void {
    this.c.resetReviewDraft();
    this.reasonChange.emit(this.c.data()?.run?.review?.reason ?? '');
    const state = this.c.data();
    if (state && this.selected())
      this.useForm.emit({ state, items: this.c.items() });
  }
}
