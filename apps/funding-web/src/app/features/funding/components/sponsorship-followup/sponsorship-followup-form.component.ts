import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type ValidatorFn
} from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  SponsorshipFollowupResponse,
  SponsorshipDraftSnapshot,
  SponsorshipDraftValues
} from '@openg7/funding-core';

import {
  canEditSponsorshipDetails,
  normalizeSponsorshipDetails,
  sameSponsorshipDetails,
  sponsorshipDetailsFromFollowup,
  type SponsorshipDetailsDraft
} from '../../models/sponsorship-followup-ui.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { SponsorshipFollowupMediaComponent } from './sponsorship-followup-media.component.js';

type FormField = keyof SponsorshipDetailsDraft;
const optionalHttpsUrlValidator: ValidatorFn = (control) => {
  const value = String(control.value ?? '').trim();
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? null : { httpsUrl: true };
  } catch {
    return { httpsUrl: true };
  }
};
const trimmedRequired: ValidatorFn = (control) =>
  String(control.value ?? '').trim() ? null : { required: true };

@Component({
  selector: 'openg7-sponsorship-followup-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslatePipe,
    SponsorshipFollowupMediaComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-form.component.html',
  styleUrls: ['./sponsorship-followup.css']
})
export class SponsorshipFollowupFormComponent implements AfterViewInit {
  readonly followup = input.required<SponsorshipFollowupResponse>();
  readonly token = input.required<string>();
  readonly busy = input(false);
  readonly draftBlocked = input(false);
  readonly savedDetails = input<SponsorshipDetailsDraft | null>(null);
  readonly restoredDraft = input<SponsorshipDraftSnapshot | null>(null);
  private appliedRestoredDraft: SponsorshipDraftSnapshot | null = null;
  readonly saveState = input<'idle' | 'saved' | 'error' | 'unconfirmed'>(
    'idle'
  );
  readonly save = output<SponsorshipDetailsDraft>();
  readonly draftChanged = output<SponsorshipDraftValues>();
  readonly discardDraft = output<void>();
  readonly i18n = inject(FundingI18nService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly revision = signal(0);
  private initialized = false;
  private appliedFollowup: SponsorshipFollowupResponse | null = null;
  private appliedSavedDetails: SponsorshipDetailsDraft | null = null;
  private readonly baseline = signal<SponsorshipDetailsDraft | null>(null);
  readonly editing = signal(false);
  readonly submitted = signal(false);
  readonly mediaBusy = signal(false);
  readonly fields = [
    'companyName',
    'contactName',
    'contactEmail',
    'websiteUrl',
    'message'
  ] as const;
  readonly sponsorshipForm = this.formBuilder.nonNullable.group({
    companyName: ['', [trimmedRequired, Validators.maxLength(200)]],
    contactName: ['', [trimmedRequired, Validators.maxLength(200)]],
    contactEmail: [
      '',
      [trimmedRequired, Validators.email, Validators.maxLength(200)]
    ],
    websiteUrl: ['', [Validators.maxLength(2048), optionalHttpsUrlValidator]],
    logoUrl: ['', [Validators.maxLength(2048), optionalHttpsUrlValidator]],
    message: ['', [Validators.maxLength(1000)]]
  });
  readonly allowed = computed(
    () =>
      canEditSponsorshipDetails(this.followup().paymentStatus) &&
      this.followup().reviewStatus !== 'rejected'
  );
  readonly readOnly = computed(
    () =>
      !this.allowed() ||
      (this.followup().reviewStatus === 'approved' && !this.editing())
  );
  readonly changed = computed(() => {
    this.revision();
    const baseline = this.baseline();
    return (
      !baseline ||
      !sameSponsorshipDetails(this.sponsorshipForm.getRawValue(), baseline)
    );
  });
  readonly canSubmit = computed(
    () =>
      !this.busy() &&
      !this.draftBlocked() &&
      !this.mediaBusy() &&
      !this.readOnly() &&
      ((!this.followup().detailsSubmitted && !this.savedDetails()) ||
        this.changed())
  );
  readonly formErrors = computed(() => {
    this.revision();
    this.i18n.trackTranslationState();
    return [...this.fields, 'logoUrl' as const].filter((field) =>
      this.errorFor(field)
    );
  });

  constructor() {
    this.sponsorshipForm.events
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.revision.update((value) => value + 1));
    this.sponsorshipForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (!this.readOnly())
          this.draftChanged.emit(this.sponsorshipForm.getRawValue());
      });
    effect(() => {
      const current = this.followup();
      const saved = this.savedDetails();
      const restored = this.restoredDraft();
      untracked(() => {
        const followupChanged = current !== this.appliedFollowup;
        this.appliedFollowup = current;
        if (saved && saved !== this.appliedSavedDetails) {
          this.appliedSavedDetails = saved;
          this.reset(saved);
          this.editing.set(false);
        } else if (restored && restored !== this.appliedRestoredDraft) {
          this.appliedRestoredDraft = restored;
          this.reset(sponsorshipDetailsFromFollowup(current));
          if (restored.data) {
            this.sponsorshipForm.patchValue(restored.data, {
              emitEvent: false
            });
            this.editing.set(true);
            this.revision.update((value) => value + 1);
          } else this.editing.set(false);
        } else if (
          !this.initialized ||
          (followupChanged && !this.editing() && !this.changed())
        ) {
          this.reset(sponsorshipDetailsFromFollowup(current));
        }
        this.initialized = true;
      });
    });
  }

  ngAfterViewInit(): void {
    this.scheduleAutofillSync();
  }

  beginEditing(): void {
    this.editing.set(true);
    if (isPlatformBrowser(this.platformId)) {
      const timer = setTimeout(() => {
        if (!this.destroyRef.destroyed) this.focusFirstField();
      });
      this.destroyRef.onDestroy(() => clearTimeout(timer));
    }
  }

  cancelEditing(): void {
    this.discardDraft.emit();
  }

  submit(): void {
    if (
      this.busy() ||
      this.draftBlocked() ||
      this.mediaBusy() ||
      this.readOnly()
    )
      return;
    this.syncFormControlsFromInputs();
    this.submitted.set(true);
    this.sponsorshipForm.markAllAsTouched();
    if (this.sponsorshipForm.invalid) {
      const first = [...this.fields, 'logoUrl' as const].find(
        (field) => this.sponsorshipForm.controls[field].invalid
      );
      if (first) this.focusField(first);
      return;
    }
    if (!this.canSubmit()) return;
    this.save.emit(
      normalizeSponsorshipDetails(this.sponsorshipForm.getRawValue())
    );
  }

  errorFor(field: FormField): string {
    this.revision();
    const control = this.sponsorshipForm.controls[field];
    if ((!control.touched && !this.submitted()) || !control.errors) return '';
    const key = control.hasError('required')
      ? 'required'
      : control.hasError('email')
        ? 'email'
        : control.hasError('httpsUrl')
          ? 'https'
          : 'length';
    return this.i18n.t('funding.followup.form.errors.' + key, {
      field: this.i18n.t('funding.followup.form.' + field)
    });
  }

  focusFirstField(): void {
    this.focusField('companyName');
  }
  focusField(field: FormField): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.host.nativeElement
      .querySelector<HTMLInputElement>('#followup-' + field)
      ?.focus();
  }

  private reset(value: SponsorshipDetailsDraft): void {
    this.baseline.set(normalizeSponsorshipDetails(value));
    this.sponsorshipForm.reset(
      {
        ...value,
        websiteUrl: value.websiteUrl ?? '',
        logoUrl: value.logoUrl ?? '',
        message: value.message ?? ''
      },
      { emitEvent: false }
    );
    this.submitted.set(false);
    this.revision.update((value) => value + 1);
    this.scheduleAutofillSync();
  }

  private scheduleAutofillSync(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const timers = [0, 250, 1000].map((delay) =>
      setTimeout(() => {
        if (
          !this.destroyRef.destroyed &&
          !this.readOnly() &&
          !this.busy() &&
          !this.draftBlocked()
        )
          this.syncFormControlsFromInputs();
      }, delay)
    );
    this.destroyRef.onDestroy(() =>
      timers.forEach((timer) => clearTimeout(timer))
    );
  }

  private syncFormControlsFromInputs(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const values: Partial<Record<FormField, string>> = {};
    for (const field of [...this.fields, 'logoUrl' as const]) {
      const input = this.host.nativeElement.querySelector<HTMLInputElement>(
        '#followup-' + field
      );
      if (input && input.value !== this.sponsorshipForm.controls[field].value)
        values[field] = input.value;
    }
    if (Object.keys(values).length > 0) this.sponsorshipForm.patchValue(values);
  }
}
