import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'openg7-funding-progress',
  standalone: true,
  template: `
    <section>
      <p>{{ label() }}</p>
      <progress [value]="confirmedTotal()" [max]="goal()"></progress>
      <p>{{ percentage() }}%</p>
    </section>
  `
})
export class FundingProgressComponent {
  readonly label = input.required<string>();
  readonly confirmedTotal = input.required<number>();
  readonly goal = input.required<number>();
  readonly percentage = computed<number>(() =>
    Math.round((this.confirmedTotal() / this.goal()) * 100)
  );
}
