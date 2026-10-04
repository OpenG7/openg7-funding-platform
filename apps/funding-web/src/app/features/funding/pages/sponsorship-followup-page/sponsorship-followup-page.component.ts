import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  effect,
  inject
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { SponsorshipAccessRecoveryComponent } from '../../components/sponsorship-followup/sponsorship-access-recovery.component.js';
import { SponsorshipFollowupFormComponent } from '../../components/sponsorship-followup/sponsorship-followup-form.component.js';
import { SponsorshipFollowupStatusComponent } from '../../components/sponsorship-followup/sponsorship-followup-status.component.js';
import type { SponsorshipDetailsDraft } from '../../models/sponsorship-followup-ui.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingService } from '../../services/funding.service.js';
import { SponsorshipDraftService } from '../../services/sponsorship-draft.service.js';
import { SponsorshipFollowupBrowser } from '../../services/sponsorship-followup-browser.js';
import { SponsorshipFollowupController } from '../../services/sponsorship-followup-controller.js';

@Component({
  selector: 'openg7-sponsorship-followup-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent,
    SponsorshipFollowupFormComponent,
    SponsorshipFollowupStatusComponent,
    SponsorshipAccessRecoveryComponent
  ],
  providers: [SponsorshipDraftService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-page.component.html',
  styleUrls: ['../../components/sponsorship-followup/sponsorship-followup.css']
})
export class SponsorshipFollowupPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fundingService = inject(FundingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  readonly i18n = inject(FundingI18nService);
  readonly drafts = inject(SponsorshipDraftService);
  private readonly controller = new SponsorshipFollowupController({
    api: this.fundingService,
    drafts: this.drafts,
    browser: new SponsorshipFollowupBrowser(() =>
      isPlatformBrowser(this.platformId)
    )
  });
  @ViewChild(SponsorshipFollowupFormComponent)
  private form?: SponsorshipFollowupFormComponent;

  readonly token = this.controller.token;
  readonly recoveryEntry = this.controller.recoveryEntry;
  readonly followup = this.controller.followup;
  readonly loading = this.controller.loading;
  readonly saving = this.controller.saving;
  readonly loadError = this.controller.loadError;
  readonly saveState = this.controller.saveState;
  readonly savedDetails = this.controller.savedDetails;
  readonly busy = this.controller.busy;
  readonly needsDetails = this.controller.needsDetails;
  readonly nextStepMessage = this.controller.nextStepMessage;

  constructor() {
    effect(() => {
      if (this.drafts.accessExpired()) this.controller.clearAccess();
    });
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.controller.dispose());
    void this.controller.initialize(
      this.route.snapshot.queryParamMap.get('token')
    );
  }

  load(): Promise<boolean> {
    return this.controller.load();
  }

  submit(value: SponsorshipDetailsDraft): Promise<void> {
    return this.controller.submit(value);
  }

  reloadDraft(): Promise<void> {
    return this.controller.reloadDraft();
  }

  focusForm(): void {
    this.form?.focusFirstField();
  }
}
