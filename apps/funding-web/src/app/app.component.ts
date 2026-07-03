import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { SiteMusicComponent } from './features/funding/components/site-music/site-music.component.js';

@Component({
  selector: 'openg7-root',
  standalone: true,
  imports: [RouterOutlet, SiteMusicComponent],
  template: `
    <router-outlet />
    <openg7-site-music />
  `
})
export class AppComponent {}
