import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export interface SponsorPresentationPhoto {
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly credit?: string | null;
}

export interface SponsorPresentationPlacement {
  readonly url: string;
  readonly target: string | null;
  readonly channels: readonly string[];
}

/** Funding presentation only; callers retain media access, loading and publication authority. */
@Component({
  selector: 'openg7-sponsor-presentation-card',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './sponsor-presentation-card.component.html',
  styleUrl: './sponsor-presentation-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SponsorPresentationCardComponent {
  readonly companyName = input.required<string>();
  readonly summary = input<string | null>(null);
  readonly logoSource = input<string | null>(null);
  readonly logoCredit = input<string | null>(null);
  readonly photo = input<SponsorPresentationPhoto | null>(null);
  readonly amountLabel = input<string | null>(null);
  readonly websiteUrl = input<string | null>(null);
  readonly placement = input<SponsorPresentationPlacement | null>(null);
  readonly imageFailed = output<string>();
  readonly initials = computed(() =>
    this.companyName()
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('')
  );
}
