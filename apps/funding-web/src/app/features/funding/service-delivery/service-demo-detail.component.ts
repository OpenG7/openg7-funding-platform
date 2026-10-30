import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';

import { FundingI18nService } from '../services/funding-i18n.service.js';

import enTranslations from './i18n/service-demo-detail.en.json' with { type: 'json' };
import frTranslations from './i18n/service-demo-detail.fr-CA.json' with { type: 'json' };
import { ServiceDemoLinkDirective as RouterLink } from './service-demo-link.directive.js';
import { ServiceDemoNavigation } from './service-demo-navigation.js';
import { DEMO_DETAIL_PAGES } from './service-demo-pages.js';
import { ServiceDemoPreviewComponent } from './service-demo-preview.component.js';
import { ServiceDemoActionsDirective } from './service-demo-actions.directive.js';
import { ServiceDemoTransitionDirective } from './service-demo-transition.directive.js';
import {
  ServiceDemoState,
  type ServiceDemoContent
} from './service-demo-state.js';

export { DEMO_DETAIL_PAGES };

@Component({
  selector: 'openg7-service-demo-detail',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    ServiceDemoPreviewComponent,
    ServiceDemoActionsDirective,
    ServiceDemoTransitionDirective
  ],
  templateUrl: './service-demo-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .comparison-heading {
        margin-bottom: 18px;
      }
      .comparison-heading p {
        margin-top: 8px;
      }
      .comparison-version {
        min-width: 0;
      }
      .comparison-version h3 {
        margin-top: 8px;
      }
      .comparison-text {
        margin-top: 16px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        line-height: 1.65;
      }
      .comparison-version.changed {
        border-color: #bad4f6;
        background: #fcfdff;
      }
      .comparison-summary {
        margin-top: 18px;
      }
      .comparison-summary > p {
        margin-top: 8px;
      }
      .comparison-changes {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        padding: 0;
        margin: 12px 0 18px;
        list-style: none;
      }
      .comparison-changes li {
        padding: 4px 9px;
        border-radius: 6px;
        color: #214f87;
        background: #ecf4ff;
        font-size: 12px;
      }
      .comparison-details summary {
        min-height: 44px;
        cursor: pointer;
        font-weight: 600;
        padding-block: 10px;
      }
      .comparison-details summary:focus-visible {
        outline: 3px solid #075dde;
        outline-offset: 3px;
      }
      .comparison-fields {
        display: block;
        margin-top: 8px;
      }
      .comparison-fields > div {
        display: grid;
        grid-template-columns: minmax(120px, 0.7fr) minmax(0, 1fr) minmax(
            0,
            1fr
          );
        gap: 14px;
        padding: 14px 0;
        border-top: 1px solid #e1e9f3;
      }
      .comparison-fields dt,
      .comparison-fields dd {
        min-width: 0;
      }
      .comparison-fields dt small {
        display: block;
        font-size: 11px;
        margin-top: 4px;
        font-weight: 400;
      }
      .comparison-fields dt {
        font-weight: 600;
      }
      .comparison-fields dd {
        color: #142843;
        overflow-wrap: anywhere;
      }
      .comparison-fields dd small {
        display: block;
        margin-bottom: 4px;
      }
      .restore-actions {
        justify-content: flex-start;
      }
      @media (max-width: 600px) {
        .comparison-fields > div {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px 14px;
        }
        .comparison-fields dt {
          grid-column: 1 / -1;
        }
        .restore-actions .button {
          width: 100%;
        }
      }
    `
  ]
})
export class ServiceDemoDetailComponent {
  readonly state = inject(ServiceDemoState);
  readonly pages = DEMO_DETAIL_PAGES;
  private readonly navigation = inject(ServiceDemoNavigation);
  private readonly data = this.navigation.data;
  private readonly query = this.navigation.query;
  readonly page = computed(() => String(this.data()['detail'] ?? 'apercu'));
  readonly definition = computed(() =>
    DEMO_DETAIL_PAGES.find((page) => page.path === this.page())
  );
  readonly draftText = computed(() =>
    this.state.text() || this.state.textEdited()
      ? this.state.text()
      : this.state.i18n.t('serviceDemo.preview.text', {
          name: this.state.dossier().name
        })
  );
  readonly comment = this.state.commentDraft;
  readonly commentSaved = signal(false);
  readonly proofName = this.state.proofName;
  readonly proofNote = this.state.proofNote;
  readonly selectedVersion = computed(() =>
    this.query().get('comparaison') === 'exemple' || !this.state.savedContent()
      ? 'exemple'
      : 'conserve'
  );
  readonly previewKind = computed(() =>
    ['web', 'confirmer-visibilite'].includes(this.page()) ||
    (this.page() === 'apercu' &&
      ['web', 'confirmer-visibilite'].includes(
        this.query().get('origine') ?? ''
      ))
      ? ('web' as const)
      : ('facebook' as const)
  );
  readonly referenceContent = computed<ServiceDemoContent>(() =>
    this.selectedVersion() === 'conserve' && this.state.savedContent()
      ? this.state.savedContent()!
      : {
          text: this.t('copy.originalText'),
          textEdited: true,
          link:
            'https://example.com/' + encodeURIComponent(this.state.currentId()),
          mention: '',
          imageIncluded: true,
          imageAsset: 'panorama',
          imageAlt: '',
          showLink: true
        }
  );
  readonly referenceText = computed(() =>
    this.contentText(this.referenceContent())
  );
  readonly savedText = computed(() => {
    const saved = this.state.savedContent();
    return saved ? this.contentText(saved) : '';
  });
  readonly comparisonFields = computed(() => {
    const reference = this.referenceContent();
    const value = (
      key: string,
      before: string,
      after: string,
      changed: boolean
    ) => ({
      key,
      label: this.t('comparison.fields.' + key),
      before,
      after,
      changed
    });
    return [
      value(
        'text',
        this.referenceText(),
        this.draftText(),
        this.referenceText() !== this.draftText()
      ),
      value(
        'link',
        reference.link || this.t('comparison.empty'),
        this.state.link() || this.t('comparison.empty'),
        reference.link !== this.state.link()
      ),
      value(
        'mention',
        reference.mention || this.t('comparison.empty'),
        this.state.mention() || this.t('comparison.empty'),
        reference.mention !== this.state.mention()
      ),
      value(
        'image',
        this.imageLabel(reference.imageIncluded, reference.imageAsset),
        this.imageLabel(this.state.imageIncluded(), this.state.imageAsset()),
        reference.imageIncluded !== this.state.imageIncluded() ||
          reference.imageAsset !== this.state.imageAsset()
      ),
      value(
        'imageAlt',
        reference.imageAlt || this.t('comparison.automaticAlt'),
        this.state.imageAlt() || this.t('comparison.automaticAlt'),
        reference.imageAlt !== this.state.imageAlt()
      ),
      value(
        'showLink',
        this.t(reference.showLink ? 'comparison.visible' : 'comparison.hidden'),
        this.t(
          this.state.showLink() ? 'comparison.visible' : 'comparison.hidden'
        ),
        reference.showLink !== this.state.showLink()
      )
    ];
  });
  readonly changedFields = computed(() =>
    this.comparisonFields().filter((field) => field.changed)
  );
  readonly comparisonMetadata = computed(() =>
    this.comparisonFields().filter((field) => field.key !== 'text')
  );
  readonly restored = signal(false);
  readonly statusFilter = signal('all');
  readonly checked = signal(false);
  readonly messageSource = computed(() =>
    this.query().get('source') === 'demander-correction'
      ? 'demander-correction'
      : 'demander-accord'
  );
  readonly confirmationNext = computed(() => {
    switch (this.page()) {
      case 'confirmer-envoi':
        return { path: 'resultat', label: 'actions.viewResult' };
      case 'confirmer-visibilite':
        return { path: 'web', label: 'actions.returnWebsite' };
      case 'approuver-preparation':
        return { path: 'contenu', label: 'actions.reviewDraftContent' };
      default:
        return { path: 'publication', label: 'actions.preparePublication' };
    }
  });

  readonly confirmationPages = new Set([
    'confirmer-envoi',
    'confirmer-visibilite',
    'approuver-preparation',
    'annuler-autorisation',
    'confirmer-autorisation'
  ]);

  constructor() {
    const i18n = inject(FundingI18nService);
    i18n.mergeTranslations('fr-CA', frTranslations);
    i18n.mergeTranslations('en', enTranslations);
  }

  t(key: string): string {
    return this.state.t(`serviceDemoDetail.${key}`);
  }

  value(event: Event): string {
    return (
      event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    ).value;
  }

  selectFile(event: Event): void {
    this.proofName.set(
      (event.target as HTMLInputElement).files?.[0]?.name ?? ''
    );
  }

  chooseComparison(value: string): void {
    void this.navigation.navigate([], {
      queryParams: {
        comparaison: value === 'exemple' ? 'exemple' : 'conserve'
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  restoreDraft(): void {
    if (!this.state.canRestoreDraft()) return;
    this.state.restoreSavedDraft();
    this.restored.set(true);
  }

  useProposal(): void {
    this.setText(this.t('copy.proposedText'));
  }

  setText(text: string): void {
    this.state.text.set(text);
    this.state.textEdited.set(true);
    this.markDirty();
  }

  setLink(link: string): void {
    this.state.link.set(link);
    this.markDirty();
  }

  toggleImage(): void {
    this.state.imageIncluded.set(!this.state.imageIncluded());
    this.markDirty();
  }

  private markDirty(): void {
    this.state.dirty.set(true);
    this.state.saved.set(false);
  }

  private contentText(content: ServiceDemoContent): string {
    return content.text || content.textEdited
      ? content.text
      : this.state.i18n.t('serviceDemo.preview.text', {
          name: this.state.dossier().name
        });
  }

  private imageLabel(
    included: boolean,
    asset: 'panorama' | 'companion'
  ): string {
    return this.t(
      !included
        ? 'comparison.hidden'
        : asset === 'panorama'
          ? 'comparison.panorama'
          : 'comparison.companion'
    );
  }
}
