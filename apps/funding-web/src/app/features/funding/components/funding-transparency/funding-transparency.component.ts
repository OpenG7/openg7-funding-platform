import { Component, input } from '@angular/core';

@Component({
  selector: 'openg7-funding-transparency',
  standalone: true,
  template: `
    <section>
      <h2>{{ title() }}</h2>
      <p>{{ confirmedLabel() }}: {{ confirmed() }} CAD</p>
      <p>{{ feesLabel() }}: {{ fees() }} CAD</p>
      <p>{{ availableLabel() }}: {{ available() }} CAD</p>
    </section>
  `
})
export class FundingTransparencyComponent {
  readonly title = input.required<string>();
  readonly confirmedLabel = input.required<string>();
  readonly feesLabel = input.required<string>();
  readonly availableLabel = input.required<string>();
  readonly confirmed = input.required<number>();
  readonly fees = input.required<number>();
  readonly available = input.required<number>();
}
