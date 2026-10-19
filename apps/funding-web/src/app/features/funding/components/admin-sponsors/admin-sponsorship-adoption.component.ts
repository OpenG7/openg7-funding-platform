import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  untracked
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminSponsorsQualityI18nService } from '../../services/admin-sponsors-quality-i18n.service.js';

import { AdminSponsorshipAdoptionController } from './admin-sponsorship-adoption-controller.js';

/** Funding organism for the portfolio inventory, separate from agreement editing. */
@Component({
  selector: 'openg7-admin-sponsorship-adoption',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  templateUrl: './admin-sponsorship-adoption.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-adoption.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminSponsorshipAdoptionComponent {
  readonly canOwn = input.required<boolean>();
  readonly labels = inject(AdminSponsorsQualityI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly destroy = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly c = new AdminSponsorshipAdoptionController({
    canOwn: () => this.canOwn(),
    destroyed: () => this.destroy.destroyed,
    identity: () => this.identityKey(),
    preview: (size, cursor) =>
      this.admin.sponsorshipCommitmentAdoptionPreview(size, cursor),
    unauthorized: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });

  constructor() {
    effect(() => {
      this.identityKey();
      this.canOwn();
      untracked(() => this.c.reset());
    });
  }

  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'owner'}`;
  }

  setPageSize(event: Event): void {
    this.c.pageSize.set(
      (event.target as HTMLSelectElement).value === '50' ? 50 : 25
    );
    void this.c.load();
  }
}
