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
    <article
      data-og7="admin-metric"
      [attr.aria-label]="label()"
      [class.embedded]="embedded()"
      [class.compact]="compact()"
    >
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
  styleUrls: ['./admin-theme.css', './admin-metric-card.component.css']
})
export class AdminMetricCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly detail = input.required<string>();
  readonly icon = input.required<AdminIconName>();
  readonly tone = input<'blue' | 'gold' | 'green'>('blue');
  readonly embedded = input(false);
  readonly compact = input(false);
}
