import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PublicationPreparationEntry,
  PublicationPreparationQueue
} from '@openg7/funding-core';

/** Funding organism: allocation facts and labelled server possibilities, without mutation. */
@Component({
  selector: 'openg7-publication-source-queue',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publication-source-queue.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-controls.css',
    './publication-source-queue.component.css'
  ]
})
export class PublicationSourceQueueComponent {
  readonly queue = input<PublicationPreparationQueue | undefined>();
  readonly busy = input(false);
  readonly dateLabel = input.required<(value: string) => string>();
  readonly refresh = output<void>();
  readonly page = output<number>();

  sourceEditable(entry: PublicationPreparationEntry): boolean {
    return (
      !entry.deliveryId ||
      entry.deliveryStatus === 'draft' ||
      entry.deliveryStatus === 'blocked'
    );
  }

  previousOffset(queue: PublicationPreparationQueue): number {
    return Math.max(0, queue.offset - queue.limit);
  }
}
