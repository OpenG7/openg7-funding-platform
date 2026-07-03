import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FundingAllocation } from '@openg7/funding-models';

@Component({
  selector: 'openg7-funding-allocation',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="allocation-card">
      <h2>{{ title() }}</h2>
      <div class="chart-layout">
        <div class="donut" [style.background]="donutGradient()"></div>
        <ul>
          <li *ngFor="let item of allocation()">
            <span>{{ item.category }}</span>
            <em>{{ share(item.amount) }}%</em>
            <strong>{{ formatCad(item.amount) }} $</strong>
          </li>
        </ul>
      </div>
      <p class="foot-note">{{ footNoteLabel() }}</p>
    </section>
  `,
  styles: [
    `
      .allocation-card {
        min-height: 100%;
      }

      .allocation-card h2 {
        color: #eff8ff;
        margin: 0 0 0.8rem;
      }

      .chart-layout {
        align-items: start;
        display: grid;
        gap: 0.85rem;
        grid-template-columns: auto 1fr;
      }

      .donut {
        border-radius: 999px;
        height: 5.7rem;
        position: relative;
        width: 5.7rem;
      }

      .donut::after {
        background: #082640;
        border-radius: 999px;
        content: '';
        inset: 0.95rem;
        position: absolute;
      }

      .allocation-card ul {
        display: grid;
        gap: 0.5rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .allocation-card li {
        align-items: center;
        color: #c1d9ee;
        display: flex;
        gap: 0.5rem;
      }

      .allocation-card em {
        color: #7fc0e8;
        font-size: 0.9rem;
        font-style: normal;
        margin-left: auto;
      }

      .allocation-card strong {
        color: #9ddfff;
        font-weight: 600;
        white-space: nowrap;
      }

      .foot-note {
        border-top: 1px solid #285277;
        color: #8fb7d5;
        font-size: 0.86rem;
        margin: 0.8rem 0 0;
        padding-top: 0.65rem;
      }

      @media (max-width: 1100px) {
        .chart-layout {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class FundingAllocationComponent {
  readonly title = input.required<string>();
  readonly footNoteLabel = input.required<string>();
  readonly allocation = input.required<readonly FundingAllocation[]>();
  readonly total = computed<number>(() =>
    this.allocation().reduce((sum, item) => sum + item.amount, 0)
  );

  readonly donutGradient = computed<string>(() => {
    const colors = ['#32c2ff', '#43d8b4', '#ffc94b', '#6ca3ff'];
    const items = this.allocation();
    const total = this.total();
    let cursor = 0;
    const chunks = items.map((item, index) => {
      const fraction = total > 0 ? (item.amount / total) * 100 : 0;
      const start = cursor;
      cursor += fraction;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    });

    return `conic-gradient(${chunks.join(', ')})`;
  });

  share(amount: number): number {
    return this.total() > 0 ? Math.round((amount / this.total()) * 100) : 0;
  }

  formatCad(value: number): string {
    return value.toFixed(2);
  }
}
