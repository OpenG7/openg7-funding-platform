import { Component, input } from '@angular/core';

@Component({
  selector: 'openg7-funding-impact',
  standalone: true,
  template: `<section>
    <h2>{{ title() }}</h2>
    <p>{{ description() }}</p>
  </section>`
})
export class FundingImpactComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
}
