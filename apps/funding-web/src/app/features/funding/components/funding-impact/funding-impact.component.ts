import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface FundingImpactItem {
  readonly title: string;
  readonly description: string;
}

@Component({
  selector: 'openg7-funding-impact',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="impact-card">
      <h2>{{ title() }}</h2>
      <ul>
        <li *ngFor="let item of items()">
          <strong>{{ item.title }}</strong>
          <span>{{ item.description }}</span>
        </li>
      </ul>
      <p>{{ description() }}</p>
    </section>
  `,
  styleUrl: './funding-impact.component.css'
})
export class FundingImpactComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly items = input.required<readonly FundingImpactItem[]>();
}
