import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Presentation molecule for short corrections with a controller. */
@Component({
  selector: 'openg7-pilot-keyboard',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    class="keys"
    [attr.aria-label]="'admin.pilotage.keyboard' | translate"
  >
    @for (key of keys; track key) {
      <button type="button" (click)="append(key)">
        {{ upper() ? key.toUpperCase() : key }}
      </button>
    }
    <button
      type="button"
      (click)="upper.set(!upper())"
      [attr.aria-pressed]="upper()"
    >
      ⇧
    </button>
    <button type="button" (click)="append(' ')">
      {{ 'admin.pilotage.space' | translate }}
    </button>
    <button
      type="button"
      (click)="changed.emit(value().slice(0, -1))"
      [attr.aria-label]="'admin.pilotage.backspace' | translate"
    >
      ⌫
    </button>
    <button
      type="button"
      (click)="
        append(
          '
'
        )
      "
    >
      ↵
    </button>
  </div>`,
  styleUrl: './pilot-keyboard.component.css'
})
export class PilotKeyboardComponent {
  readonly value = input('');
  readonly changed = output<string>();
  readonly upper = signal(false);
  readonly keys = Array.from('abcdefghijklmnopqrstuvwxyzéèàçù0123456789.,!?-');
  append(key: string): void {
    this.changed.emit(
      (this.value() + (this.upper() ? key.toUpperCase() : key)).slice(0, 2900)
    );
  }
}
