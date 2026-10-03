import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import {
  AdminIconComponent,
  type AdminIconName
} from './admin-icon.component.js';

/** Presentation-only metric. Its value and explanation come from the page. */
@Component({
  selector: 'openg7-admin-metric-card',
  standalone: true,
  imports: [AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article [attr.aria-label]="label()" [class.embedded]="embedded()">
      <span class="icon" [attr.data-tone]="tone()"
        ><openg7-admin-icon [name]="icon()"
      /></span>
      <div>
        <h2>{{ label() }}</h2>
        <strong>{{ value() }}</strong>
        <p>{{ detail() }}</p>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      article {
        align-items: start;
        background: linear-gradient(
          140deg,
          var(--admin-panel-raised, #192a40),
          var(--admin-panel)
        );
        border: 1px solid var(--admin-border);
        border-radius: 0.8rem;
        display: flex;
        gap: 1rem;
        height: 100%;
        padding: 1.2rem;
      }
      div {
        min-width: 0;
      }
      article.embedded {
        background: transparent;
        border: 0;
        border-radius: 0;
        padding-bottom: 1rem;
      }
      .embedded strong {
        font-size: clamp(1.9rem, 2.3vw, 2.5rem);
        letter-spacing: -0.04em;
      }
      h2 {
        color: var(--admin-text);
        font-size: 0.9rem;
        font-weight: 500;
        margin: 0;
      }
      strong {
        display: block;
        font-size: clamp(1.45rem, 1.7vw, 1.9rem);
        line-height: 1.3;
        margin: 0.3rem 0;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      p {
        color: var(--admin-muted);
        font-size: 0.78rem;
        margin: 0;
      }
      .icon {
        align-items: center;
        background: #203f64;
        border-radius: 0.8rem;
        color: #9bcdff;
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 1.6rem;
        height: 3rem;
        justify-content: center;
        width: 3rem;
      }
      [data-tone='gold'] {
        color: #ffda85;
        background: #3b3529;
      }
      [data-tone='green'] {
        color: #a1e7b1;
        background: #204639;
      }
    `
  ]
})
export class AdminMetricCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly detail = input.required<string>();
  readonly icon = input.required<AdminIconName>();
  readonly tone = input<'blue' | 'gold' | 'green'>('blue');
  readonly embedded = input(false);
}
