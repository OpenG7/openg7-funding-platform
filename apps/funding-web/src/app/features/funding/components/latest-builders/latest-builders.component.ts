import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ContributorRecord } from '@openg7/funding-models';

@Component({
  selector: 'openg7-latest-builders',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="builders-card">
      <h2>{{ title() }}</h2>
      <ul>
        <li *ngFor="let contributor of contributors(); let index = index">
          <span class="avatar" aria-hidden="true">
            {{ initials(contributor.displayName) }}
          </span>
          <span class="identity">
            <strong>{{ contributor.displayName }}</strong>
            <small>{{ relativeTime(index) }}</small>
          </span>
          <strong class="amount">{{ contributor.amount }} $</strong>
        </li>
      </ul>
      <p class="thanks">{{ thanksLabel() }}</p>
    </section>
  `,
  styles: [
    `
      .builders-card {
        min-height: 100%;
      }

      .builders-card h2 {
        color: #eff8ff;
        margin: 0 0 0.8rem;
      }

      .builders-card ul {
        display: grid;
        gap: 0.65rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .builders-card li {
        align-items: center;
        background: #09243d;
        border: 1px solid #1a4266;
        border-radius: 0.75rem;
        color: #c1d9ee;
        display: flex;
        gap: 0.75rem;
        padding: 0.55rem 0.65rem;
      }

      .avatar {
        align-items: center;
        background: linear-gradient(160deg, #25b9ff, #256fff);
        border-radius: 999px;
        color: #f5fbff;
        display: inline-flex;
        font-size: 0.7rem;
        font-weight: 700;
        height: 1.75rem;
        justify-content: center;
        width: 1.75rem;
      }

      .identity {
        display: grid;
        gap: 0.05rem;
      }

      .identity strong {
        color: #f4faff;
      }

      .identity small {
        color: #7ea6c5;
        font-size: 0.75rem;
      }

      .amount {
        color: #f9fdff;
        font-weight: 600;
        margin-left: auto;
      }

      .thanks {
        color: #8fb7d5;
        font-size: 0.86rem;
        margin: 0.75rem 0 0;
      }
    `
  ]
})
export class LatestBuildersComponent {
  readonly title = input.required<string>();
  readonly contributors = input.required<readonly ContributorRecord[]>();
  readonly recentLabels = input.required<readonly string[]>();
  readonly recentFallbackLabel = input.required<string>();
  readonly thanksLabel = input.required<string>();

  initials(name: string): string {
    const parts = name.split(' ').filter((token) => token.length > 0);
    if (parts.length === 0) {
      return '--';
    }

    return parts
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() ?? '')
      .join('');
  }

  relativeTime(index: number): string {
    return this.recentLabels()[index] ?? this.recentFallbackLabel();
  }
}
