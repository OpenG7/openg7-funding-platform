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
      <header>
        <h1>{{ 'admin.attention.title' | translate }}</h1>
        <p class="subtitle">
          <strong data-og7="admin-workspace-mode" data-og7-id="prioritize">{{
            'admin.modes.prioritize' | translate
          }}</strong>
        </p>
      </header>
      <openg7-admin-attention-panel /></div
  ></openg7-admin-layout>`,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-attention-page.component.css'
  ]
})
export class AdminAttentionPageComponent {}
