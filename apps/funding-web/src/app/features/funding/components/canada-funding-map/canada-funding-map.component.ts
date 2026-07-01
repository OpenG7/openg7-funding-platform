import { Component, input } from '@angular/core';

@Component({
  selector: 'openg7-canada-funding-map',
  standalone: true,
  template: `
    <section [attr.aria-label]="title()">
      <h2>{{ title() }}</h2>
      <p>{{ placeholder() }}</p>
    </section>
  `
})
export class CanadaFundingMapComponent {
  readonly title = input.required<string>();
  readonly placeholder = input.required<string>();
}
