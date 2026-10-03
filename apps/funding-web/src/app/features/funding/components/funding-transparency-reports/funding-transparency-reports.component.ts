import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export type TransparencyReportIntent = 'csv' | 'json' | 'copy';

/** Funding presentation organism: explains public reports and emits export intentions. */
@Component({
  selector: 'openg7-funding-transparency-reports',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-transparency-reports.component.html',
  styleUrl: './funding-transparency-reports.component.css'
})
export class FundingTransparencyReportsComponent {
  readonly period = input.required<string>();
  readonly canExport = input.required<boolean>();
  readonly copyState = input<'' | 'copied' | 'copyFailed'>('');
  readonly action = output<TransparencyReportIntent>();

  requestAction(intent: TransparencyReportIntent): void {
    if (intent === 'copy' || this.canExport()) this.action.emit(intent);
  }
}
