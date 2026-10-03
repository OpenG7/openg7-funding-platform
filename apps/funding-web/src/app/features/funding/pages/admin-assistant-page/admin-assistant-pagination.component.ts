import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Local presentation surface; the routed page owns HTTP and navigation. */
@Component({
  selector: 'openg7-admin-assistant-pagination',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-pagination.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-assistant-surface.css',
    './admin-assistant-pagination.component.css'
  ]
})
export class AdminAssistantPaginationComponent {
  readonly page = input.required<number>();
  readonly pages = input.required<number>();
  readonly ready = input.required<boolean>();
  readonly generatedAtLabel = input.required<string>();
  readonly pageChanged = output<number>();
}
