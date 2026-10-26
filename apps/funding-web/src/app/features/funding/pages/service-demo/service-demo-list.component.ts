import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import en from '../../../../../assets/i18n/service-demo-list.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/service-demo-list.fr-CA.json' with { type: 'json' };
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';

import { DEMO_DOSSIERS, ServiceDemoState } from './service-demo-state.js';

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
  imports: [RouterLink, TranslatePipe, AdminIconComponent],
  templateUrl: './service-demo-list.component.html',
  styleUrl: './service-demo-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDemoListComponent {
  readonly state = inject(ServiceDemoState);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });
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
    )
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
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { etat: null },
      queryParamsHandling: 'merge'
    });
  }

  resetFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: null, etat: null },
      queryParamsHandling: 'merge'
    });
  }

  search(value: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }
}
