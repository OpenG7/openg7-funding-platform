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
  styles: [
    `
      .hero-copy h1 {
        color: #f4fbff;
        font-size: clamp(2rem, 4.6vw, 4rem);
        line-height: 1.04;
        margin: 0;
      }

      .hero-copy p {
        color: #b1cbe3;
        font-size: clamp(1rem, 1.8vw, 1.5rem);
        line-height: 1.35;
        margin: 1rem 0 1.3rem;
        max-width: 28ch;
      }
    `
  ]
})
export class FundingHeroComponent {
  readonly campaignTitle = input.required<string>();
  readonly campaignDescription = input.required<string>();
}
