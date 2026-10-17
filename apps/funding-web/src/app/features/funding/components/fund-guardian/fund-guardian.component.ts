import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';

import {
  computeGlowIntensity,
  computeGlowSpread,
  normalizeProgress
} from '../../models/funding-visual.utils.js';

@Component({
  selector: 'openg7-fund-guardian',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure
      class="guardian-figure"
      [style.--guardian-gold-intensity]="goldIntensity()"
      [style.--guardian-gold-spread]="goldSpread() + 'rem'"
      [style.--guardian-blue-intensity]="blueIntensity()"
    >
      <div class="guardian-blue-halo" aria-hidden="true"></div>
      <div class="guardian-gold-halo" aria-hidden="true"></div>
      <img
        class="guardian-image"
        [src]="asset()"
        [alt]="alt()"
        width="768"
        height="1152"
        decoding="async"
        fetchpriority="high"
      />
    </figure>
  `,
  styleUrl: './fund-guardian.component.css'
})
export class FundGuardianComponent {
  readonly asset = input.required<string>();
  readonly alt = input.required<string>();
  readonly progress = input.required<number>();

  readonly normalizedProgress = computed<number>(() =>
    normalizeProgress(this.progress())
  );
  readonly goldIntensity = computed<number>(() =>
    computeGlowIntensity(this.normalizedProgress())
  );
  readonly goldSpread = computed<number>(() =>
    computeGlowSpread(this.normalizedProgress())
  );
  readonly blueIntensity = computed<number>(
    () => 0.25 + (this.normalizedProgress() / 100) * 0.38
  );
}
