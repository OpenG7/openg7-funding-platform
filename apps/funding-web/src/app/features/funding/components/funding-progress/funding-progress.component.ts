import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'openg7-funding-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="progress-card">
      <p class="objective-label">{{ goalLabel() }}</p>
      <p class="objective-amount">{{ goal() }} {{ currencyCode() }}</p>
      <div class="progress-head">
        <p>{{ confirmedTotal() }} {{ currencyCode() }} {{ confirmedLabel() }}</p>
        <strong>{{ percentage() }} %</strong>
      </div>
      <progress [value]="confirmedTotal()" [max]="goal()"></progress>
      <div class="progress-meta">
        <span>{{ confirmedTotal() }} {{ currencyCode() }} {{ confirmedLabel() }}</span>
        <span>{{ remainingAmount() }} {{ currencyCode() }} {{ remainingLabel() }}</span>
      </div>
      <p class="caption">{{ label() }}</p>
    </section>
  `,
  styles: [
    `
      .progress-card {
        margin-top: 1rem;
      }

      .progress-head {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 0.45rem;
      }

      .objective-label {
        color: #8db2d1;
        margin: 0;
      }

      .objective-amount {
        color: #ffd46b;
        font-size: 2rem;
        font-weight: 700;
        margin: 0.1rem 0 0.45rem;
      }

      .progress-head p {
        color: #d1e6f8;
        margin: 0;
      }

      .progress-head strong {
        color: #9cdfff;
        white-space: nowrap;
      }

      .progress-card progress {
        width: 100%;
        height: 0.65rem;
      }

      .progress-card progress::-webkit-progress-bar {
        background: #13314c;
        border-radius: 999px;
      }

      .progress-card progress::-webkit-progress-value {
        background: linear-gradient(90deg, #00d2ff, #197dff);
        border-radius: 999px;
      }

      .progress-meta {
        color: #8db2d1;
        display: flex;
        font-size: 0.83rem;
        justify-content: space-between;
        margin-top: 0.45rem;
      }

      .caption {
        color: #7fa6c7;
        font-size: 0.88rem;
        margin: 0.5rem 0 0;
      }
    `
  ]
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
    this.goal() > 0 ? Math.round((this.confirmedTotal() / this.goal()) * 100) : 0
  );
  readonly remainingAmount = computed<number>(() =>
    Math.max(this.goal() - this.confirmedTotal(), 0)
  );
}
