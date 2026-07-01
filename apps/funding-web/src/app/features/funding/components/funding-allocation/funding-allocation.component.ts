import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { FundingAllocation } from '@openg7/funding-models';

@Component({
  selector: 'openg7-funding-allocation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section>
      <h2>{{ title() }}</h2>
      <ul>
        <li *ngFor="let item of allocation()">
          {{ item.category }}: {{ item.amount }} CAD
        </li>
      </ul>
    </section>
  `
})
export class FundingAllocationComponent {
  readonly title = input.required<string>();
  readonly allocation = input.required<readonly FundingAllocation[]>();
}
