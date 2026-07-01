import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { ContributorRecord } from '@openg7/funding-models';

@Component({
  selector: 'openg7-latest-builders',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section>
      <h2>{{ title() }}</h2>
      <ul>
        <li *ngFor="let contributor of contributors()">
          {{ contributor.displayName }} — {{ contributor.amount }} CAD
        </li>
      </ul>
    </section>
  `
})
export class LatestBuildersComponent {
  readonly title = input.required<string>();
  readonly contributors = input.required<readonly ContributorRecord[]>();
}
