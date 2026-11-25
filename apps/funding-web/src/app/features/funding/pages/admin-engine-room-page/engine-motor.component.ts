import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Decorative motor illustration. No animation or operational state is inferred. */
@Component({
  selector: 'openg7-engine-motor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-state]': 'state()', 'aria-hidden': 'true' },
  template: `
    <div class="motor-shell">
      <div class="motor-housing"></div>
      <div class="motor-face">
        <div class="motor-blades">
          @for (blade of blades; track blade) {
            <i
              [style.transform]="
                'rotate(' +
                blade * 30 +
                'deg)' +
                ' translateY(-30%) skewY(-22deg)'
              "
            ></i>
          }
        </div>
        <div class="motor-hub">
          <span>{{ symbol() }}</span>
        </div>
      </div>
      <div class="motor-base"><span></span><span></span><span></span></div>
      <div class="motor-floor"></div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        --motor-light: #49bce8;
        --motor-shadow: #082d45;
      }
      :host([data-state='off']) {
        --motor-light: #8b9baa;
        --motor-shadow: #25303c;
      }
      :host([data-state='attention']) {
        --motor-light: #ffc452;
        --motor-shadow: #61400b;
      }
      :host([data-state='verified']) {
        --motor-light: #4ee1de;
        --motor-shadow: #074d56;
      }
      .motor-shell {
        position: relative;
        width: min(100%, var(--motor-width, 20rem));
        height: var(--motor-height, 14rem);
        margin: auto;
        isolation: isolate;
      }
      .motor-housing {
        position: absolute;
        inset: 12% 8% 22% 23%;
        border-radius: 44%;
        transform: skewY(-9deg);
        background: repeating-linear-gradient(
          90deg,
          #14212e 0 5%,
          #647583 6% 8%,
          #b3c0c7 9%,
          #1d303e 11% 15%
        );
        box-shadow:
          inset 0 0 1rem #030b16,
          0 0 1.5rem color-mix(in srgb, var(--motor-light) 22%, transparent);
      }
      .motor-face {
        position: absolute;
        left: 9%;
        top: 5%;
        width: 62%;
        aspect-ratio: 1;
        border-radius: 50%;
        transform: rotateY(-14deg);
        border: 0.45rem solid #81929e;
        background: radial-gradient(circle, #162b3b 0 20%, #06111d 60%);
        box-shadow:
          inset 0 0 0 0.22rem #07111e,
          inset 0 0 0 0.45rem var(--motor-light),
          0 0 0 0.15rem #162330,
          0 0 1.1rem color-mix(in srgb, var(--motor-light) 45%, transparent);
      }
      .motor-blades {
        position: absolute;
        inset: 9%;
        overflow: hidden;
        border-radius: 50%;
        border: 1px solid var(--motor-light);
        background: radial-gradient(circle, #071521, var(--motor-shadow));
      }
      i {
        position: absolute;
        left: 43%;
        top: 9%;
        width: 22%;
        height: 62%;
        transform-origin: 30% 67%;
        border-radius: 90% 12% 72% 20%;
        background: linear-gradient(
          100deg,
          #06111b 5%,
          #587382 30%,
          #c9e2e9 37%,
          var(--motor-light) 42%,
          #172b3c 58%,
          #020b14 95%
        );
        box-shadow: 2px 0 3px #0009;
      }
      .motor-hub {
        position: absolute;
        inset: 31%;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 25%, #385064, #06111d 70%);
        border: 2px solid var(--motor-light);
        box-shadow:
          0 0 0 4px #7f94a3,
          0 0 0 6px #0b1825,
          0 0 1rem var(--motor-shadow);
      }
      .motor-hub span {
        color: #f0fbff;
        font: 700 1.6rem/1 system-ui;
        letter-spacing: -0.05em;
      }
      .motor-base {
        position: absolute;
        z-index: -1;
        left: 14%;
        right: 9%;
        bottom: 9%;
        height: 29%;
        clip-path: polygon(12% 0, 87% 0, 100% 100%, 0 100%);
        background: linear-gradient(
          100deg,
          #152b3a,
          #91a0aa 15%,
          #142b3e 20% 80%,
          #718a9a 85%,
          #0a1622
        );
        border-bottom: 4px solid var(--motor-light);
        display: flex;
        justify-content: space-evenly;
        align-items: end;
        padding-bottom: 8%;
      }
      .motor-base span {
        width: 16%;
        height: 12%;
        background: var(--motor-light);
        box-shadow: 0 0 0.5rem var(--motor-light);
      }
      .motor-floor {
        position: absolute;
        z-index: -2;
        bottom: 0;
        left: 0;
        right: 0;
        height: 20%;
        border-radius: 50%;
        background: radial-gradient(
          ellipse,
          color-mix(in srgb, var(--motor-light) 30%, transparent),
          transparent 65%
        );
      }
    `
  ]
})
export class EngineMotorComponent {
  readonly symbol = input('G7');
  readonly state = input<'off' | 'attention' | 'verified' | 'unknown'>(
    'unknown'
  );
  readonly blades = Array.from({ length: 12 }, (_, index) => index);
}
