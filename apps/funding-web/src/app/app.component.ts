import { Component } from '@angular/core';

import { FundingPageComponent } from './features/funding/pages/funding-page/funding-page.component.js';

@Component({
  selector: 'openg7-root',
  standalone: true,
  imports: [FundingPageComponent],
  template: '<openg7-funding-page />'
})
export class AppComponent {}
