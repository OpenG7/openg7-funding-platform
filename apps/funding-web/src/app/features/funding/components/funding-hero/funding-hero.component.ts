import { Component, input } from '@angular/core';

@Component({
  selector: 'openg7-funding-hero',
  standalone: true,
  template: `
    <section aria-labelledby="campaign-title">
      <h1 id="campaign-title">{{ campaignTitle() }}</h1>
      <p>{{ campaignDescription() }}</p>
    </section>
  `
})
export class FundingHeroComponent {
  readonly campaignTitle = input.required<string>();
  readonly campaignDescription = input.required<string>();
}
