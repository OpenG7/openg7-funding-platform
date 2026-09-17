import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminAttentionPanelComponent } from '../../components/admin-attention/admin-attention-panel.component.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';

@Component({
  selector: 'openg7-admin-attention-page',
  standalone: true,
  imports: [TranslatePipe, AdminLayoutComponent, AdminAttentionPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<openg7-admin-layout
    ><div class="queue-page">
      <h1>{{ 'admin.attention.title' | translate }}</h1>
      <openg7-admin-attention-panel /></div
  ></openg7-admin-layout>`,
  styles: [
    `
      .queue-page {
        padding: clamp(1rem, 2vw, 2rem);
      }
      h1 {
        color: #f2f5fa;
        margin: 0 0 1.25rem;
      }
    `
  ]
})
export class AdminAttentionPageComponent {}
