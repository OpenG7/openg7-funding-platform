import { Component, input } from '@angular/core';

@Component({
  selector: 'openg7-fund-guardian',
  standalone: true,
  template: `<figure><img [src]="asset()" [alt]="alt()" /></figure>`
})
export class FundGuardianComponent {
  readonly asset = input.required<string>();
  readonly alt = input.required<string>();
}
