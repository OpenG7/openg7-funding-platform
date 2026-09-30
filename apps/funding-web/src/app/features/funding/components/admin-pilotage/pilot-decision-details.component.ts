import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import type { PilotAction, PilotDecision } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';

export type PilotDetailState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'changed'
  | 'missing'
  | 'error'
  | 'forbidden'
  | 'expired';

/** Read-only decision presentation. The page owns data loading and navigation. */
@Component({
  selector: 'openg7-pilot-decision-details',
  standalone: true,
  imports: [AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pilot-decision-details.component.html',
  styleUrl: './pilot-decision-details.component.css'
})
export class PilotDecisionDetailsComponent {
  readonly decision = input.required<PilotDecision>();
  readonly kind = input.required<string>();
  readonly icon = input.required<AdminIconName>();
  readonly image = input('');
  readonly imageFailed = input(false);
  readonly state = input<PilotDetailState>('idle');
  readonly primaryAction = input<PilotAction>();
  readonly consequence = input('');
  readonly reload = output<void>();
  readonly previewFailed = output<void>();
  readonly i18n = inject(FundingI18nService);
  readonly facts = computed(() =>
    this.decision().facts.filter(
      (f) =>
        (!this.decision().publication ||
          !['destination', 'mode'].includes(f.label)) &&
        (!this.decision().project?.expected_outcome || f.label !== 'outcome')
    )
  );
  readonly hasPreview = computed(
    () =>
      !!(
        this.decision().publication ||
        this.decision().sponsor ||
        this.decision().project
      )
  );
  readonly previewExpected = computed(
    () =>
      !!(
        this.decision().publication?.mediaId ||
        this.decision().publication?.mediaUrl ||
        this.decision().sponsor?.presentationId
      )
  );
  readonly destination = computed(() => {
    const parts = this.decision().publication?.feedId.split(':') ?? [];
    return {
      brand:
        parts[0] === 'openg7'
          ? 'OpenG7'
          : parts[0] === 'openg20'
            ? 'OpenG20'
            : parts[0],
      channel:
        parts[1] === 'facebook'
          ? 'Facebook'
          : parts[1] === 'linkedin'
            ? 'LinkedIn'
            : parts[1]
    };
  });

  t(key: string): string {
    return this.i18n.t('admin.pilotage.detail.' + key);
  }
  factLabel(label: string): string {
    const key = 'admin.pilotage.facts.' + label;
    const translated = this.i18n.t(key);
    return translated === key ? label : translated;
  }
  date(value: string | null): string {
    return value
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Toronto'
        }).format(new Date(value))
      : this.i18n.t('admin.pilotage.undated');
  }
}
