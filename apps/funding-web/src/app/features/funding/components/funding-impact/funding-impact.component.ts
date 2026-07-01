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
  styles: [
    `
      .impact-card {
        min-height: 100%;
      }

      .impact-card h2 {
        color: #eff8ff;
        margin: 0 0 0.8rem;
      }

      .impact-card ul {
        display: grid;
        gap: 0.5rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .impact-card li {
        color: #c1d9ee;
        display: grid;
        gap: 0.15rem;
        padding-left: 1.4rem;
        position: relative;
      }

      .impact-card strong {
        color: #eaf6ff;
      }

      .impact-card span {
        color: #8db2d0;
        font-size: 0.86rem;
      }

      .impact-card li::before {
        background: radial-gradient(circle, #17b7ff, #1a6bff);
        border-radius: 999px;
        content: '';
        height: 0.62rem;
        left: 0;
        position: absolute;
        top: 0.38rem;
        width: 0.62rem;
      }

      .impact-card p {
        border-top: 1px solid #285277;
        color: #95b8d6;
        margin: 0.85rem 0 0;
        padding-top: 0.8rem;
      }
    `
  ]
})
export class FundingImpactComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly items = input.required<readonly FundingImpactItem[]>();
}
