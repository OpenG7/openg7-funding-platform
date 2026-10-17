import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
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
  styleUrl: './funding-allocation.component.css'
})
export class FundingAllocationComponent {
  readonly title = input.required<string>();
  readonly footNoteLabel = input.required<string>();
  readonly allocation = input.required<readonly FundingAllocation[]>();
  readonly total = computed<number>(() =>
    this.allocation().reduce((sum, item) => sum + item.amount, 0)
  );

  readonly donutGradient = computed<string>(() => {
    const colors = [
      'var(--color-primary)',
      'var(--color-gold)',
      '#729174',
      '#7A5E49'
    ];
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
