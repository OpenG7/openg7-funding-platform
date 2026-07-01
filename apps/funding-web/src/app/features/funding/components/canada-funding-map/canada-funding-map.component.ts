import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'openg7-canada-funding-map',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div *ngIf="decorative(); else functionalMap" class="map-ambient" aria-hidden="true">
      <div class="map-shape"></div>
      <div class="map-lines"></div>
    </div>

    <ng-template #functionalMap>
      <section class="map-card" [attr.aria-label]="title()">
        <h2>{{ title() }}</h2>
        <ul>
          <li><span class="dot oil"></span>{{ legendOil() }}</li>
          <li><span class="dot electric"></span>{{ legendElectricity() }}</li>
          <li><span class="dot services"></span>{{ legendServices() }}</li>
          <li><span class="dot labor"></span>{{ legendLabor() }}</li>
        </ul>
        <p>{{ placeholder() }}</p>
        <button type="button">{{ actionLabel() }}</button>
      </section>
    </ng-template>
  `,
  styles: [
    `
      .map-ambient {
        inset: 0;
        pointer-events: none;
        position: absolute;
      }

      .map-shape {
        background:
          radial-gradient(circle at 62% 50%, rgb(50 145 255 / 18%), transparent 63%),
          linear-gradient(150deg, rgb(30 88 145 / 48%), rgb(26 60 105 / 18%));
        clip-path: polygon(9% 48%, 24% 34%, 39% 39%, 56% 29%, 77% 36%, 90% 51%, 81% 71%, 62% 79%, 42% 73%, 22% 79%, 8% 64%);
        height: 100%;
        margin-left: 8%;
        opacity: 0.48;
        width: 86%;
      }

      .map-lines {
        background:
          radial-gradient(circle, rgb(255 195 92 / 75%) 0 1.5px, transparent 2.5px),
          linear-gradient(140deg, transparent 44%, rgb(126 217 255 / 30%) 50%, transparent 56%),
          linear-gradient(18deg, transparent 48%, rgb(255 210 132 / 24%) 53%, transparent 60%);
        background-size: 110px 74px, 100% 100%, 100% 100%;
        inset: 7% 3% 8% 10%;
        mix-blend-mode: screen;
        opacity: 0.32;
        position: absolute;
      }

      .map-card {
        display: grid;
        gap: 0.8rem;
      }

      .map-card h2 {
        color: #eff8ff;
        margin: 0;
      }

      .map-card ul {
        display: grid;
        gap: 0.4rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .map-card li {
        color: #d2e7f8;
        display: flex;
        gap: 0.5rem;
      }

      .dot {
        border-radius: 999px;
        display: inline-block;
        height: 0.65rem;
        margin-top: 0.35rem;
        width: 0.65rem;
      }

      .oil {
        background: #ff645a;
      }

      .electric {
        background: #ffd146;
      }

      .services {
        background: #31c3ff;
      }

      .labor {
        background: #46ca74;
      }

      .map-card p {
        color: #96bad7;
        margin: 0;
      }

      .map-card button {
        background: transparent;
        border: 1px solid #2d587e;
        border-radius: 0.75rem;
        color: #d6ebfb;
        cursor: pointer;
        justify-self: start;
        min-height: 2.4rem;
        padding: 0.58rem 0.95rem;
      }
    `
  ]
})
export class CanadaFundingMapComponent {
  readonly decorative = input<boolean>(false);
  readonly title = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly actionLabel = input.required<string>();
  readonly legendOil = input.required<string>();
  readonly legendElectricity = input.required<string>();
  readonly legendServices = input.required<string>();
  readonly legendLabor = input.required<string>();
}
