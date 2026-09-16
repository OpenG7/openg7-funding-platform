import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type AdminBadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'openg7-admin-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [attr.data-tone]="tone()"><ng-content /></span>`,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      span {
        background: #213650;
        border: 1px solid #526980;
        border-radius: 0.4rem;
        color: #dce8f8;
        font-size: 0.8rem;
        font-weight: 600;
        padding: 0.25rem 0.6rem;
      }
      [data-tone='success'] {
        background: #183d32;
        border-color: #457e5d;
        color: #a1e7b1;
      }
      [data-tone='warning'] {
        background: #3b3223;
        border-color: #806b3b;
        color: #ffda85;
      }
      [data-tone='danger'] {
        background: #432630;
        border-color: #925565;
        color: #ffb5bc;
      }
    `
  ]
})
export class AdminBadgeComponent {
  readonly tone = input<AdminBadgeTone>('neutral');
}
