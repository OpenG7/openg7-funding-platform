import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const paths = {
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
  dashboard: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  assistant:
    'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM20 2v4m-2-2h4',
  contributions: 'M12 2v20m5-15c0-4-10-4-10 0s10 3 10 8-10 4-10 0',
  sponsors:
    'M8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM16 4a3 3 0 0 1 0 6M2 21v-4a6 6 0 0 1 12 0v4H2Zm16-8a5 5 0 0 1 4 5v3h-4',
  publications: 'M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8M8 16h6',
  invoices: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm3 5h8M8 12h8M8 16h4',
  expenses: 'M3 3v18h18M6 15l4-6 4 3 6-8M16 4h4v4',
  transparency: 'M12 3 2 8l10 5 10-5-10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  email: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  audit: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-5 9 3 3 7-7',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  logout: 'M9 3H3v18h6m6-15 6 6-6 6M7 12h14',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'm6 6 12 12M6 18 18 6',
  refresh:
    'M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5m-4 6a8 8 0 0 0 14 5l3-3m0 5v-5h-5',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4v6l4 2',
  warning: 'M12 3 1 21h22L12 3Zm0 6v5m0 3v1',
  mountain: 'm2 20 6-9 4 4 6-12 4 17M6 14l2 2 2-2m6-7 2 3 2-1'
} as const;

export type AdminIconName = keyof typeof paths;

/** Decorative icon; the enclosing control supplies its accessible name. */
@Component({
  selector: 'openg7-admin-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path [attr.d]="paths[name()]" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: 0 0 auto;
        width: 1.3em;
        height: 1.3em;
      }
      svg {
        width: 100%;
        height: 100%;
      }
    `
  ]
})
export class AdminIconComponent {
  readonly name = input.required<AdminIconName>();
  readonly paths = paths;
}
