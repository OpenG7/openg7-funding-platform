import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'openg7-funding-transparency',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="stat-card">
      <div class="head">
        <h2>{{ title() }}</h2>
        <button type="button">{{ detailsLabel() }}</button>
      </div>
      <p>
        <span>{{ confirmedLabel() }}</span>
        <strong>{{ formatCad(confirmed()) }} $</strong>
      </p>
      <p>
        <span>{{ feesLabel() }}</span>
        <strong>{{ formatCad(fees()) }} $</strong>
      </p>
      <p class="available">
        <span>{{ availableLabel() }}</span>
        <strong>{{ formatCad(available()) }} $</strong>
      </p>
      <p class="live">{{ liveUpdateLabel() }}</p>
    </section>
  `,
  styleUrl: './funding-transparency.component.css'
})
export class FundingTransparencyComponent {
  readonly title = input.required<string>();
  readonly detailsLabel = input.required<string>();
  readonly liveUpdateLabel = input.required<string>();
  readonly confirmedLabel = input.required<string>();
  readonly feesLabel = input.required<string>();
  readonly availableLabel = input.required<string>();
  readonly confirmed = input.required<number>();
  readonly fees = input.required<number>();
  readonly available = input.required<number>();

  formatCad(value: number): string {
    return value.toFixed(2);
  }
}
