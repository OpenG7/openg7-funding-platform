import {
  Injectable,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import type { PublicSponsorshipCharter } from '@openg7/funding-core';

import { FundingService } from './funding.service.js';
import { FundingI18nService } from './funding-i18n.service.js';

/** Public activation comes from the API. Proposed clauses never become active through a UI toggle. */
@Injectable({ providedIn: 'root' })
export class SponsorshipCharterService {
  private generation = 0;
  private readonly funding = inject(FundingService);
  private readonly i18n = inject(FundingI18nService);
  readonly charter = signal<PublicSponsorshipCharter | null>(null);
  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly text = computed(() =>
    this.charter()?.active
      ? (this.charter()?.text?.[
          this.i18n.currentLanguage() === 'en' ? 'en' : 'fr'
        ] ?? '')
      : ''
  );
  constructor() {
    afterNextRender(() => void this.load());
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.charter.set(null);
    this.state.set('loading');
    try {
      const charter = await this.funding.getSponsorshipCharter();
      if (generation !== this.generation) return;
      this.charter.set(charter);
      this.state.set('ready');
    } catch {
      if (generation !== this.generation) return;
      this.state.set('error');
    }
  }
}
