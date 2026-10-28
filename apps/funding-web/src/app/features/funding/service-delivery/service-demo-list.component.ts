import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminIconComponent } from '../components/admin-ui/admin-icon.component.js';

import { DossierMediaPreviewComponent } from './dossier-media-preview.component.js';
import en from './i18n/service-demo-list.en.json' with { type: 'json' };
import fr from './i18n/service-demo-list.fr-CA.json' with { type: 'json' };
import { ServiceDemoLinkDirective as RouterLink } from './service-demo-link.directive.js';
import { ServiceDemoNavigation } from './service-demo-navigation.js';
import { DEMO_DOSSIERS, ServiceDemoState } from './service-demo-state.js';
import { ServiceDemoTabsDirective } from './service-demo-tabs.directive.js';
import { ServiceDemoTransitionDirective } from './service-demo-transition.directive.js';

const filterIds = ['all', 'contenu', 'autorisation', 'publication'] as const;

function normalizeSearchTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr-CA')
    .trim();
}

@Component({
  selector: 'openg7-service-demo-list',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    DossierMediaPreviewComponent,
    ServiceDemoTabsDirective,
    ServiceDemoTransitionDirective
  ],
  templateUrl: './service-demo-list.component.html',
  styleUrl: './service-demo-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDemoListComponent {
  readonly state = inject(ServiceDemoState);
  private readonly navigation = inject(ServiceDemoNavigation);
  private readonly params = this.navigation.query;
  readonly query = computed(() => this.params().get('q') ?? '');
  readonly selectedFilter = computed(() => {
    const candidate = this.params().get('etat');
    return filterIds.find((id) => id === candidate) ?? 'all';
  });
  readonly filters = filterIds.map((id) => ({
    id,
    count:
      id === 'all'
        ? DEMO_DOSSIERS.length
        : DEMO_DOSSIERS.filter((dossier) => dossier.stage === id).length
  }));
  readonly totalDossiers = DEMO_DOSSIERS.length;
  readonly totalServices = DEMO_DOSSIERS.length * 2;
  readonly hasFilters = computed(
    () => this.query().length > 0 || this.selectedFilter() !== 'all'
  );
  readonly dossiers = computed(() =>
    DEMO_DOSSIERS.filter(
      (dossier) =>
        (this.selectedFilter() === 'all' ||
          dossier.stage === this.selectedFilter()) &&
        normalizeSearchTerm(dossier.name).includes(
          normalizeSearchTerm(this.query())
        )
    ).map((dossier) => ({
      ...dossier,
      media: this.state.mediaForDossier(dossier.id)
    }))
  );
  readonly resultIds = computed(() =>
    this.dossiers()
      .map((dossier) => dossier.id)
      .join('|')
  );

  constructor() {
    this.state.i18n.mergeTranslations('fr-CA', fr);
    this.state.i18n.mergeTranslations('en', en);
    effect(() => {
      this.state.query.set(this.query());
      this.state.filter.set(this.selectedFilter());
    });
  }

  clearFilter(): void {
    void this.navigation.navigate([], {
      queryParams: { etat: null },
      queryParamsHandling: 'merge'
    });
  }

  resetFilters(): void {
    void this.navigation.navigate([], {
      queryParams: { q: null, etat: null },
      queryParamsHandling: 'merge'
    });
  }

  search(value: string): void {
    void this.navigation.navigate([], {
      queryParams: { q: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }
}
