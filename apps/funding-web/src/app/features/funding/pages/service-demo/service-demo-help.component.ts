import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import en from '../../../../../assets/i18n/service-demo-help.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/service-demo-help.fr-CA.json' with { type: 'json' };

import { ServiceDemoState } from './service-demo-state.js';

const stepContexts = new Set([
  'contenu',
  'autorisation',
  'publication',
  'corriger',
  'historique'
]);

/** A small, optional explanation of the task currently in view. */
@Component({
  selector: 'openg7-service-demo-help',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './service-demo-help.component.html',
  styleUrl: './service-demo-help.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDemoHelpComponent {
  readonly state = inject(ServiceDemoState);
  readonly isList = input(false);
  readonly context = computed(() => {
    if (this.isList()) return 'liste';
    const page = this.state.page();
    if (!page) return 'dossier';
    return stepContexts.has(page) ? page : 'details';
  });

  constructor() {
    this.state.i18n.mergeTranslations('fr-CA', fr);
    this.state.i18n.mergeTranslations('en', en);
  }
}
