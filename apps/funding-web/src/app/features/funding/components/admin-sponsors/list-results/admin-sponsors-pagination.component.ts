import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'openg7-admin-sponsors-pagination',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.compact]': 'compact()' },
  templateUrl: './admin-sponsors-pagination.component.html',
  styleUrls: [
    '../../admin-ui/admin-theme.css',
    '../../admin-ui/admin-controls.css',
    '../../admin-ui/admin-forms.css',
    './admin-sponsors-pagination.component.css'
  ]
})
export class AdminSponsorsPaginationComponent {
  readonly compact = input(false);
  readonly paginationStart = input.required<number>();
  readonly paginationEnd = input.required<number>();
  readonly totalItems = input.required<number>();
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly pageSizeOptions = input.required<readonly number[]>();

  readonly previousPage = output<void>();
  readonly nextPage = output<void>();
  readonly pageSizeChange = output<number>();

  onPageSizeChange(event: Event): void {
    const value = Number.parseInt(
      (event.target as HTMLSelectElement | null)?.value ?? '',
      10
    );
    if (Number.isFinite(value)) {
      this.pageSizeChange.emit(value);
    }
  }
}
