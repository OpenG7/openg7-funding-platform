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
  styles: [
    `
      .stat-card {
        min-height: 100%;
      }

      .head {
        align-items: center;
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.8rem;
      }

      .stat-card h2 {
        color: #eff8ff;
        margin: 0;
      }

      .stat-card button {
        background: rgb(18 52 84 / 45%);
        border: 1px solid #245379;
        border-radius: 0.65rem;
        color: #d1e7fb;
        cursor: pointer;
        min-height: 2rem;
        padding: 0 0.7rem;
      }

      .stat-card p {
        align-items: center;
        color: #c1d9ee;
        display: flex;
        justify-content: space-between;
        margin: 0.4rem 0;
      }

      .stat-card strong {
        color: #eff8ff;
      }

      .available {
        border-top: 1px solid #285277;
        color: #6be3b3;
        font-size: 1.2rem;
        font-weight: 700;
        margin-top: 0.85rem;
        padding-top: 0.75rem;
      }

      .available strong {
        color: #6be3b3;
      }

      .live {
        color: #81cea8;
        font-size: 0.87rem;
        justify-content: flex-start;
        margin-top: 0.6rem;
      }

      .live::before {
        background: #33d181;
        border-radius: 999px;
        content: '';
        display: inline-block;
        height: 0.5rem;
        margin-right: 0.5rem;
        width: 0.5rem;
      }
    `
  ]
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
