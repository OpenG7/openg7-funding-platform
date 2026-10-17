import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';

@Component({
  selector: 'openg7-funding-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="progress-card">
      <p class="objective-label">{{ goalLabel() }}</p>
      <p class="objective-amount">{{ goal() }} {{ currencyCode() }}</p>
      <div class="progress-head">
        <p>
          {{ confirmedTotal() }} {{ currencyCode() }} {{ confirmedLabel() }}
        </p>
        <strong>{{ percentage() }} %</strong>
      </div>
      <progress [value]="confirmedTotal()" [max]="goal()"></progress>
      <div class="progress-meta">
        <span
          >{{ confirmedTotal() }} {{ currencyCode() }}
          {{ confirmedLabel() }}</span
        >
        <span
          >{{ remainingAmount() }} {{ currencyCode() }}
          {{ remainingLabel() }}</span
        >
      </div>
      <p class="caption">{{ label() }}</p>
    </section>
  `,
  styleUrl: './funding-progress.component.css'
})
export class FundingProgressComponent {
  readonly label = input.required<string>();
  readonly goalLabel = input.required<string>();
  readonly confirmedLabel = input.required<string>();
  readonly remainingLabel = input.required<string>();
  readonly currencyCode = input<string>('CAD');
  readonly confirmedTotal = input.required<number>();
  readonly goal = input.required<number>();
  readonly percentage = computed<number>(() =>
    this.goal() > 0
      ? Math.round((this.confirmedTotal() / this.goal()) * 100)
      : 0
  );
  readonly remainingAmount = computed<number>(() =>
    Math.max(this.goal() - this.confirmedTotal(), 0)
  );
}
