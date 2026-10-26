import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import enTranslations from '../../../../../assets/i18n/service-demo-detail.en.json' with { type: 'json' };
import frTranslations from '../../../../../assets/i18n/service-demo-detail.fr-CA.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { ServiceDemoPreviewComponent } from './service-demo-preview.component.js';
import { ServiceDemoActionsDirective } from './service-demo-actions.directive.js';
import {
  ServiceDemoState,
  type ServiceDemoContent
} from './service-demo-state.js';

/** Presentation destinations only: these pages never authorize or execute an operation. */
export const DEMO_DETAIL_PAGES = [
  {
    path: 'apercu',
    titleKey: 'serviceDemoDetail.titles.preview',
    parent: 'contenu'
  },
  {
    path: 'preuves',
    titleKey: 'serviceDemoDetail.titles.evidence',
    parent: ''
  },
  {
    path: 'accord',
    titleKey: 'serviceDemoDetail.titles.agreement',
    parent: ''
  },
  { path: 'controle', titleKey: 'serviceDemoDetail.titles.check', parent: '' },
  {
    path: 'proposition',
    titleKey: 'serviceDemoDetail.titles.proposal',
    parent: 'corriger/texte'
  },
  {
    path: 'comparer',
    titleKey: 'serviceDemoDetail.titles.compare',
    parent: 'historique'
  },
  {
    path: 'commentaire',
    titleKey: 'serviceDemoDetail.titles.comment',
    parent: 'historique'
  },
  {
    path: 'demander-correction',
    titleKey: 'serviceDemoDetail.titles.requestCorrection',
    parent: 'contenu'
  },
  {
    path: 'demander-accord',
    titleKey: 'serviceDemoDetail.titles.requestAgreement',
    parent: 'autorisation'
  },
  {
    path: 'preuve',
    titleKey: 'serviceDemoDetail.titles.attachment',
    parent: 'autorisation'
  },
  {
    path: 'accord-recu',
    titleKey: 'serviceDemoDetail.titles.receivedAgreement',
    parent: 'autorisation'
  },
  {
    path: 'conditions',
    titleKey: 'serviceDemoDetail.titles.conditions',
    parent: 'autorisation'
  },
  {
    path: 'contact',
    titleKey: 'serviceDemoDetail.titles.contact',
    parent: 'autorisation'
  },
  {
    path: 'planifier',
    titleKey: 'serviceDemoDetail.titles.schedule',
    parent: 'publication'
  },
  {
    path: 'confirmer-envoi',
    titleKey: 'serviceDemoDetail.titles.confirmDelivery',
    parent: 'publication'
  },
  {
    path: 'resultat',
    titleKey: 'serviceDemoDetail.titles.result',
    parent: 'publication'
  },
  {
    path: 'reconcilier',
    titleKey: 'serviceDemoDetail.titles.reconcile',
    parent: 'resultat'
  },
  {
    path: 'attester',
    titleKey: 'serviceDemoDetail.titles.attest',
    parent: 'reconcilier'
  },
  { path: 'web', titleKey: 'serviceDemoDetail.titles.web', parent: '' },
  {
    path: 'confirmer-visibilite',
    titleKey: 'serviceDemoDetail.titles.confirmVisibility',
    parent: 'web'
  },
  {
    path: 'approuver-preparation',
    titleKey: 'serviceDemoDetail.titles.approvePreparation',
    parent: ''
  },
  {
    path: 'autres-actions',
    titleKey: 'serviceDemoDetail.titles.more',
    parent: ''
  },
  {
    path: 'quitter',
    titleKey: 'serviceDemoDetail.titles.leave',
    parent: 'corriger/texte'
  },
  {
    path: 'conflit',
    titleKey: 'serviceDemoDetail.titles.conflict',
    parent: 'corriger/texte'
  },
  {
    path: 'indisponible',
    titleKey: 'serviceDemoDetail.titles.unavailable',
    parent: ''
  },
  {
    path: 'medias',
    titleKey: 'serviceDemoDetail.titles.media',
    parent: 'corriger/image'
  },
  { path: 'guide', titleKey: 'serviceDemoDetail.titles.guide', parent: '' },
  {
    path: 'destinations',
    titleKey: 'serviceDemoDetail.titles.destinations',
    parent: ''
  },
  { path: 'filtres', titleKey: 'serviceDemoDetail.titles.filters', parent: '' },
  {
    path: 'retablir',
    titleKey: 'serviceDemoDetail.titles.restore',
    parent: 'historique'
  },
  {
    path: 'annuler-autorisation',
    titleKey: 'serviceDemoDetail.titles.revoke',
    parent: 'publication'
  },
  {
    path: 'apercu-envoi',
    titleKey: 'serviceDemoDetail.titles.messagePreview',
    parent: 'demander-accord'
  },
  {
    path: 'confirmer-autorisation',
    titleKey: 'serviceDemoDetail.titles.confirmAgreement',
    parent: 'autorisation'
  }
] as const;

@Component({
  selector: 'openg7-service-demo-detail',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    ServiceDemoPreviewComponent,
    ServiceDemoActionsDirective
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data
  });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });
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
    void this.router.navigate([], {
      relativeTo: this.route,
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
