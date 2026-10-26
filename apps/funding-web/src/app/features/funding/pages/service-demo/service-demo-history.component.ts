import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import en from '../../../../../assets/i18n/service-demo-editor.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/service-demo-editor.fr-CA.json' with { type: 'json' };
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { ServiceDemoState } from './service-demo-state.js';
import { ServiceDemoActionsDirective } from './service-demo-actions.directive.js';

const events = [
  {
    id: 'v3',
    type: 'modifications',
    day: '22',
    time: '14:22',
    actor: 'editor',
    title: 'textCorrection',
    description: 'textCorrectionHelp',
    before: 'beforeText',
    after: 'afterText'
  },
  {
    id: 'c1',
    type: 'commentaires',
    day: '22',
    time: '13:45',
    actor: 'client',
    title: 'comment',
    description: 'commentHelp',
    before: '',
    after: ''
  },
  {
    id: 'a1',
    type: 'autorisations',
    day: '22',
    time: '10:18',
    actor: 'client',
    title: 'agreement',
    description: 'agreementHelp',
    before: '',
    after: ''
  },
  {
    id: 'f1',
    type: 'fichiers',
    day: '21',
    time: '16:03',
    actor: 'editor',
    title: 'imageAdded',
    description: 'imageAddedHelp',
    before: '',
    after: ''
  },
  {
    id: 'v1',
    type: 'modifications',
    day: '21',
    time: '11:27',
    actor: 'editor',
    title: 'initialVersion',
    description: 'initialVersionHelp',
    before: '',
    after: 'beforeText'
  }
] as const;

/** Synthetic timeline; selection and filters are represented in the URL. */
@Component({
  selector: 'openg7-service-demo-history',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    ServiceDemoActionsDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './service-demo-history.component.html',
  styles: [
    `
      :host {
        display: block;
      }
      .history-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 24px;
      }
      .history-list {
        display: grid;
        gap: 8px;
      }
      .history-event {
        display: grid;
        grid-template-columns: 32px 1fr;
        gap: 12px;
        padding: 18px;
        color: inherit;
        text-decoration: none;
        border-radius: 12px;
        border: 1px solid transparent;
      }
      .history-event.active {
        background: #ecf4ff;
        border-color: #d5e6ff;
      }
      .history-event:hover {
        background: #f0f5fb;
      }
      .history-event strong,
      .history-event small {
        display: block;
      }
      .history-event small {
        margin-bottom: 8px;
      }
      .history-event p {
        margin: 4px 0 0;
      }
      .history-dot {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #ecf4ff;
        color: #075dde;
      }
      .history-version {
        padding: 16px;
        border: 1px solid #dce5ef;
        border-radius: 10px;
        background: #f5f8fc;
        white-space: pre-wrap;
      }
      .history-version.after {
        background: #eaf8f0;
        border-color: #c5e8d6;
      }
      .history-detail h3 {
        margin-top: 24px;
      }
      .history-detail {
        align-self: start;
      }
      .history-empty {
        padding: 32px 20px;
        text-align: center;
      }
    `
  ]
})
export class ServiceDemoHistoryComponent {
  readonly state = inject(ServiceDemoState);
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });
  readonly filters = [
    'tout',
    'modifications',
    'commentaires',
    'fichiers',
    'autorisations',
    'publications'
  ] as const;
  readonly filter = computed(() => this.query().get('filtre') ?? 'tout');
  readonly visibleEvents = computed(() =>
    events.filter(
      (event) => this.filter() === 'tout' || event.type === this.filter()
    )
  );
  readonly selected = computed(
    () =>
      this.visibleEvents().find(
        (event) => event.id === this.query().get('version')
      ) ?? this.visibleEvents()[0]
  );
  readonly oldestFirst = computed(() => this.query().get('ordre') === 'ancien');
  readonly sortedEvents = computed(() =>
    this.oldestFirst()
      ? [...this.visibleEvents()].reverse()
      : this.visibleEvents()
  );

  constructor() {
    const i18n = inject(FundingI18nService);
    i18n.mergeTranslations('fr-CA', fr);
    i18n.mergeTranslations('en', en);
  }
}
