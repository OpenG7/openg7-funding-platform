import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Generic command surface; the owner projects native controls and handles intentions. */
@Component({
  selector: 'openg7-bottom-command-deck',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bottom-command-deck.component.html',
  styleUrl: './bottom-command-deck.component.css',
  host: {
    'data-og7': 'bottom-command-deck',
    'data-controller-zone': 'bottom'
  }
})
export class BottomCommandDeckComponent {
  readonly title = input.required<string>();
  readonly hint = input('');
}
