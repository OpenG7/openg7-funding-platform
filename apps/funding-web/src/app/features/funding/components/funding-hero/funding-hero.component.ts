import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'openg7-funding-hero',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero-copy" aria-labelledby="campaign-title">
      <h1 id="campaign-title">{{ campaignTitle() }}</h1>
      <p>{{ campaignDescription() }}</p>
    </section>
  `,
  styleUrl: './funding-hero.component.css'
})
export class FundingHeroComponent {
  readonly campaignTitle = input.required<string>();
  readonly campaignDescription = input.required<string>();
}
