import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type AdminBadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'openg7-admin-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span data-og7="admin-badge" [attr.data-tone]="tone()"
    ><ng-content
  /></span>`,
  styleUrls: ['./admin-theme.css', './admin-badge.component.css']
})
export class AdminBadgeComponent {
  readonly tone = input<AdminBadgeTone>('neutral');
}
