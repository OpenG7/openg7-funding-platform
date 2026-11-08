import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorDetailIdentityView } from '../../models/admin-sponsors-ui.models.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { AdminSponsorMediaPreferenceComponent } from '../sponsor-media-usage/admin-sponsor-media-preference.component.js';
import { MediaReviewWorkspaceComponent } from '../media-review/media-review-workspace.component.js';
import type { MediaLibraryView } from '../media-review/media-review-workspace.controller.js';

/** One dossier's media library; identity, moderation and delivery keep their owners. */
@Component({
  selector: 'openg7-admin-sponsor-detail-media',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminIconComponent,
    MediaReviewWorkspaceComponent,
    AdminSponsorMediaPreferenceComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (languageReady()) {
      <section
        class="detail-body admin-focus-target"
        id="dossier-media"
        data-og7="dossier-media"
        tabindex="-1"
        aria-labelledby="dossier-media-title"
      >
        <header class="media-summary" data-og7="dossier-media-summary">
          <div class="library-heading">
            <span class="library-icon" aria-hidden="true"
              ><openg7-admin-icon name="image"
            /></span>
            <div>
              <h2 id="dossier-media-title" class="section-title">
                {{ t('library.title') }}
              </h2>
              <p class="muted-copy">{{ t('library.subtitle') }}</p>
            </div>
          </div>
          <div class="dossier-summary">
            @if (identity().logoPreviewSource) {
              <img
                class="logo-thumbnail"
                [src]="identity().logoPreviewSource"
                alt=""
              />
            }
            <div>
              <strong>{{ identity().companyName }}</strong>
              <p class="muted-copy">
                {{ reference() }} ·
                {{
                  dossier()?.commitment
                    ? t('library.services', { count: serviceCount() })
                    : t('library.servicesUnavailable')
                }}
              </p>
            </div>
          </div>
        </header>
        @if (identityIncomplete() || submissionPending()) {
          <aside class="identity-alert" data-og7="media-identity-alert">
            <p>
              {{
                t(
                  identityIncomplete()
                    ? 'library.identityMissing'
                    : 'library.submissionPending'
                )
              }}
            </p>
            <button
              type="button"
              class="admin-button"
              data-og7="media-open-identity"
              (click)="identityRequested.emit()"
            >
              {{ t('library.completeIdentity') }}
            </button>
          </aside>
        }
        <nav
          class="library-views"
          [attr.aria-label]="t('library.viewsLabel')"
          data-og7="media-library-views"
        >
          @for (item of views; track item) {
            <button
              type="button"
              class="admin-button"
              [attr.aria-pressed]="view() === item"
              [attr.data-og7-id]="item"
              (click)="view.set(item)"
            >
              {{ t('library.views.' + item) }}
            </button>
          }
        </nav>
        @if (identity().contributionId; as contributionId) {
          <div
            id="dossier-media-gallery"
            class="media-gallery admin-focus-target"
            data-og7="dossier-media-gallery"
            tabindex="-1"
            [attr.aria-label]="t('library.title')"
          >
            <openg7-media-review-workspace
              class="library-workspace"
              [contributionId]="contributionId"
              [libraryView]="view()"
              [headingLevel]="4"
              [disabled]="identity().mediaBusy || preferenceBusy()"
              (busyChange)="workspaceBusy.set($event)"
              (changed)="moderationChanged.emit()"
              (inspectRequested)="inspectRequested.emit()"
            />
          </div>
          @if (view() === 'corrections') {
            <section class="corrections-view" data-og7="media-corrections-view">
              <p class="muted-copy">{{ t('library.correctionsHelp') }}</p>
              <openg7-admin-sponsor-media-preference
                [contributionId]="contributionId"
                [disabled]="identity().mediaBusy || workspaceBusy()"
                (busyChange)="preferenceBusy.set($event)"
                (changed)="moderationChanged.emit()"
              />
              <button
                type="button"
                class="admin-button"
                (click)="view.set('media')"
              >
                {{ t('library.returnMedia') }}
              </button>
            </section>
          }
        } @else {
          <p class="muted-copy">{{ t('library.noDossier') }}</p>
        }
      </section>
    } @else if (languageError()) {
      <p role="alert">{{ 'admin.dossier.unavailable' | translate }}</p>
    }
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-detail-media.component.css'
  ]
})
export class AdminSponsorDetailMediaComponent {
  readonly moderationChanged = output<void>();
  readonly identityRequested = output<void>();
  readonly inspectRequested = output<void>();
  readonly identity = input.required<AdminSponsorDetailIdentityView>();
  readonly reference = input('');
  readonly dossier = input<AdminSponsorshipProgress | null>(null);
  readonly identityIncomplete = input(false);
  readonly submissionPending = input(false);
  readonly serviceCount = computed(
    () => this.dossier()?.commitment?.obligations.length ?? 0
  );
  readonly view = signal<MediaLibraryView>('media');
  readonly views: readonly MediaLibraryView[] = [
    'media',
    'presentation',
    'documents',
    'corrections'
  ];
  readonly preferenceBusy = signal(false);
  readonly workspaceBusy = signal(false);
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
  private readonly workspace = viewChild(MediaReviewWorkspaceComponent);
  /** The wrapper and its separately translated workspace must both have settled. */
  readonly layoutReady = computed(() => {
    if (this.languageError()) return true;
    if (!this.languageReady()) return false;
    const id = this.identity().contributionId;
    if (!id) return true;
    const workspace = this.workspace();
    return (
      !!workspace &&
      (workspace.languageError() ||
        (workspace.languageReady() &&
          !workspace.c.loading() &&
          (workspace.c.data()?.contributionId === id || !!workspace.c.error())))
    );
  });
  private readonly i18n = inject(FundingI18nService);
  private readonly scopeId = computed(() => this.identity().contributionId);
  private generation = 0;
  private destroyed = false;
  readonly busy = computed(
    () =>
      this.identity().mediaBusy || this.workspaceBusy() || this.preferenceBusy()
  );

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() => void this.loadLanguage(language));
    });
    effect(() => {
      this.scopeId();
      untracked(() => {
        this.view.set('media');
        this.preferenceBusy.set(false);
        this.workspaceBusy.set(false);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.generation++;
    });
  }
  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.mediaReview.' + key, params);
  }
  focusGallery(): void {
    this.view.set('media');
  }
  private async loadLanguage(language: 'fr-CA' | 'en'): Promise<void> {
    const generation = ++this.generation;
    try {
      const messages =
        language === 'en'
          ? await import('../../../../../assets/i18n/admin-media-review.en.json')
          : await import('../../../../../assets/i18n/admin-media-review.fr-CA.json');
      if (this.destroyed || generation !== this.generation) return;
      this.i18n.mergeTranslations(language, messages.default);
      this.languageReady.set(true);
      this.languageError.set(false);
    } catch {
      if (!this.destroyed) this.languageError.set(true);
    }
  }
}
