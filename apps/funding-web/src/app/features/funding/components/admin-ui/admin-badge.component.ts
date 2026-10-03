import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type AdminBadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'openg7-admin-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [attr.data-tone]="tone()"><ng-content /></span>`,
  styleUrls: ['./admin-theme.css'],
  styles: [
    `
      :host {
        display: inline-flex;
      }
      span {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        color: var(--admin-text);
        font-size: 0.8rem;
        font-weight: 600;
        padding: 0.25rem 0.6rem;
      }
      [data-tone='success'] {
        background: var(--admin-success-bg);
        border-color: var(--admin-success-border);
        color: var(--admin-success);
      }
      [data-tone='warning'] {
        background: var(--admin-warning-bg);
        border-color: var(--admin-warning-border);
        color: var(--admin-warning);
      }
      [data-tone='danger'] {
        background: var(--admin-danger-bg);
        border-color: var(--admin-danger-border);
        color: var(--admin-danger);
      }
    `
  ]
})
export class AdminBadgeComponent {
  readonly tone = input<AdminBadgeTone>('neutral');
}
