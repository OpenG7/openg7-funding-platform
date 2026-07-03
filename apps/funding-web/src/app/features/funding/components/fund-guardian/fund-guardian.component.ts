import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

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
  styles: [
    `
      .guardian-figure {
        align-items: end;
        display: grid;
        margin: 0;
        min-height: 100%;
        overflow: hidden;
        place-items: end center;
        position: relative;
      }

      .guardian-blue-halo,
      .guardian-gold-halo {
        border-radius: 999px;
        content: '';
        left: 50%;
        pointer-events: none;
        position: absolute;
        transform: translateX(-50%);
      }

      .guardian-blue-halo {
        animation: breathe-blue 7.2s ease-in-out infinite;
        background: radial-gradient(
          circle,
          rgb(53 171 255 / calc(var(--guardian-blue-intensity) * 60%)) 0%,
          rgb(19 77 145 / 0) 72%
        );
        bottom: 4%;
        filter: blur(0.2rem);
        height: 65%;
        width: 88%;
      }

      .guardian-gold-halo {
        animation: pulse-gold 5.2s ease-in-out infinite;
        background: radial-gradient(
          circle,
          rgb(255 211 102 / calc(var(--guardian-gold-intensity) * 95%)) 0%,
          rgb(255 153 42 / calc(var(--guardian-gold-intensity) * 40%)) 28%,
          rgb(255 153 42 / 0) 68%
        );
        bottom: 17%;
        box-shadow: 0 0 var(--guardian-gold-spread)
          rgb(255 186 77 / calc(var(--guardian-gold-intensity) * 55%));
        height: 24%;
        width: 38%;
      }

      .guardian-image {
        -webkit-mask-image:
          linear-gradient(to bottom, transparent 0%, black 7%, black 89%, transparent 100%),
          linear-gradient(to right, transparent 0%, black 9%, black 91%, transparent 100%);
        -webkit-mask-composite: source-in;
        display: block;
        filter: drop-shadow(0 16px 36px rgb(0 0 0 / 62%));
        margin: 0 auto;
        mask-composite: intersect;
        mask-image:
          linear-gradient(to bottom, transparent 0%, black 7%, black 89%, transparent 100%),
          linear-gradient(to right, transparent 0%, black 9%, black 91%, transparent 100%);
        max-height: min(72vh, 720px);
        max-width: min(520px, 100%);
        object-fit: contain;
      }

      @keyframes breathe-blue {
        0%,
        100% {
          opacity: 0.72;
          transform: translateX(-50%) scale(0.96);
        }

        50% {
          opacity: 1;
          transform: translateX(-50%) scale(1.02);
        }
      }

      @keyframes pulse-gold {
        0%,
        100% {
          opacity: 0.8;
          transform: translateX(-50%) scale(0.98);
        }

        50% {
          opacity: 1;
          transform: translateX(-50%) scale(1.04);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .guardian-blue-halo,
        .guardian-gold-halo {
          animation: none;
        }
      }
    `
  ]
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
  readonly blueIntensity = computed<number>(() =>
    0.25 + (this.normalizedProgress() / 100) * 0.38
  );
}
