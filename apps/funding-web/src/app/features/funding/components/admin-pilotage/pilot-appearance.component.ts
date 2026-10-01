import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type {
  PilotAppearance,
  PilotTheme
} from '../../services/pilot-appearance.service.js';

/** Admin presentation molecule: local appearance choices; no business commands. */
@Component({
  selector: 'openg7-pilot-appearance',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="intro">{{ 'admin.appearance.intro' | translate }}</p>
    <fieldset>
      <legend>{{ 'admin.appearance.palette' | translate }}</legend>
      <div class="themes">
        @for (theme of themes; track theme) {
          <label
            class="theme-card"
            [class.selected]="!settings().system && settings().theme === theme"
          >
            <div class="miniature" [attr.data-theme]="theme" aria-hidden="true">
              <span class="mini-sidebar"></span
              ><span class="mini-header"></span>
              <span class="mini-decision"><i></i><b></b><b></b><em></em></span>
              <span class="mini-queue"><i></i><i></i><i></i></span>
            </div>
            <span class="choice">
              <input
                type="radio"
                name="pilot-theme"
                [value]="theme"
                [checked]="!settings().system && settings().theme === theme"
                (change)="changed.emit({ theme, system: false })"
                [attr.data-og7]="'pilot-theme-' + theme"
              />
              <strong>{{
                'admin.appearance.themes.' + theme | translate
              }}</strong>
            </span>
            <small>{{
              'admin.appearance.descriptions.' + theme | translate
            }}</small>
          </label>
        }
      </div>
      <label class="system">
        <input
          type="checkbox"
          [checked]="settings().system"
          (change)="changed.emit({ system: $any($event.target).checked })"
          data-og7="pilot-theme-system"
        />
        <span
          ><strong>{{ 'admin.appearance.system' | translate }}</strong
          ><small>{{ 'admin.appearance.systemHint' | translate }}</small></span
        >
      </label>
      <p class="current" role="status">
        {{ 'admin.appearance.current' | translate }}
        {{ 'admin.appearance.themes.' + resolved() | translate }}
      </p>
    </fieldset>
    <fieldset>
      <legend>{{ 'admin.appearance.density' | translate }}</legend>
      <div class="densities">
        @for (density of densities; track density) {
          <label [class.selected]="settings().density === density">
            <input
              type="radio"
              name="pilot-density"
              [checked]="settings().density === density"
              (change)="changed.emit({ density })"
              [attr.data-og7]="'pilot-density-' + density"
            />
            <span
              ><strong>{{ 'admin.appearance.' + density | translate }}</strong
              ><small>{{
                'admin.appearance.' + density + 'Hint' | translate
              }}</small></span
            >
          </label>
        }
      </div>
    </fieldset>
    <p class="note" [attr.role]="storageUnavailable() ? 'status' : null">
      {{
        (storageUnavailable()
          ? 'admin.appearance.storageUnavailable'
          : 'admin.appearance.saved'
        ) | translate
      }}
    </p>
  `,
  styleUrls: ['./pilot-appearance.component.css']
})
export class PilotAppearanceComponent {
  readonly settings = input.required<PilotAppearance>();
  readonly resolved = input.required<PilotTheme>();
  readonly storageUnavailable = input(false);
  readonly changed = output<Partial<PilotAppearance>>();
  readonly themes = ['night', 'mineral', 'graphite'] as const;
  readonly densities = ['comfortable', 'compact'] as const;
}
