import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  untracked
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { SponsorshipObligation } from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminSponsorshipTimingController } from './admin-sponsorship-timing-controller.js';

@Component({
  selector: 'openg7-admin-sponsorship-timing',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-timing.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-timing.component.css'
  ]
})
export class AdminSponsorshipTimingComponent {
  readonly obligation = input.required<SponsorshipObligation>();
  readonly canOwn = input(false);
  readonly changed = output<void>();
  private readonly admin = inject(FundingAdminService);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  readonly language = inject(FundingI18nService).currentLanguage;
  readonly c = new AdminSponsorshipTimingController({
    canOwn: () => this.canOwn(),
    isDestroyed: () => this.destroy.destroyed,
    newRequestId: () => crypto.randomUUID(),
    send: (request) => this.admin.sponsorshipTimingCommand(request),
    changed: () => this.changed.emit()
  });
  constructor() {
    effect(() => {
      const o = this.obligation();
      untracked(() => this.c.select(o));
    });
  }
  readonly browser = isPlatformBrowser(this.platform);
  dateLabel(value: string): string {
    return new Intl.DateTimeFormat(this.language(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    }).format(new Date(value));
  }
  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
