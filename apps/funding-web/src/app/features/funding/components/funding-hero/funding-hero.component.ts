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
        color: var(--text-main);
        font-size: clamp(1.75rem, 3vw, 2.5rem);
        line-height: 1.2;
        margin: 0;
      }

      .hero-copy p {
        color: var(--text-soft);
        font-size: clamp(1rem, 1.4vw, 1.125rem);
        line-height: 1.5;
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
