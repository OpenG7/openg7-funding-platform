import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import type {
  AdminSponsorPublicationChannelChange,
  AdminSponsorPublicationFieldChange
} from '../../models/admin-sponsor-dossier-panels.js';
import type {
  SponsorshipPublicationChannel,
  SponsorshipPublicationDraft
} from '../../models/admin-sponsor-workflow.ports.js';
import type { AdminSponsorFeedStatusOption } from '../../models/admin-sponsors-ui.models.js';

/** Funding organism: controlled advanced publication form and private preview. */
@Component({
  selector: 'openg7-admin-sponsor-publication-panel',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-publication-panel.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-publication-panel.component.css'
  ]
})
export class AdminSponsorPublicationPanelComponent {
  readonly sponsorship = input.required<AdminSponsorshipRecord>();
  readonly draft = input.required<SponsorshipPublicationDraft>();
  readonly expanded = input(false);
  readonly actionsDisabled = input(false);
  readonly dirty = input(false);
  readonly canSave = input(false);
  readonly saving = input(false);
  readonly stateLabel = input('');
  readonly slugError = input('');
  readonly promisedChannels = input<readonly SponsorshipPublicationChannel[]>(
    []
  );
  readonly promisedChannelTitle = input('');
  readonly feedStatusOptions =
    input.required<readonly AdminSponsorFeedStatusOption[]>();
  readonly logoSource = input<string | null>(null);
  readonly logoAlt = input('');
  readonly publicName = input.required<string>();
  readonly channelsLabel = input.required<string>();

  readonly expandedChange = output<boolean>();
  readonly fieldChange = output<AdminSponsorPublicationFieldChange>();
  readonly channelChange = output<AdminSponsorPublicationChannelChange>();
  readonly save = output<void>();

  private readonly summary =
    viewChild<ElementRef<HTMLElement>>('publicationSummary');

  /** The page schedules this after opening; no browser access during SSR setup. */
  focusSummary(): void {
    const summary = this.summary()?.nativeElement;
    summary?.focus();
    summary?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
}
