import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { isPresetSelected } from '../../models/funding-visual.utils.js';

@Component({
  selector: 'openg7-contribution-selector',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="contribution-selector">
      <legend>{{ label() }}</legend>
      <div class="preset-grid">
        <button
          type="button"
          class="amount-chip"
          *ngFor="let amount of amounts()"
          [class.active]="isAmountSelected(amount)"
          (click)="setPreset(amount)"
        >
          {{ amount }} $
        </button>
      </div>
      <label [attr.for]="customId">{{ customAmountLabel() }}</label>
      <input
        [id]="customId"
        type="number"
        [formControl]="customAmountControl"
        inputmode="numeric"
        min="1"
        step="1"
        (input)="onCustomAmountInput()"
      />
    </fieldset>
  `,
  styles: [
    `
      .contribution-selector {
        border: 0;
        margin: 0;
        padding: 0;
      }

      .contribution-selector legend {
        color: #8fb6d9;
        font-size: 0.95rem;
        margin-bottom: 0.65rem;
      }

      .preset-grid {
        display: grid;
        gap: 0.65rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .amount-chip {
        background: #0c2945;
        border: 1px solid #1f4970;
        border-radius: 0.85rem;
        color: #d8ebff;
        cursor: pointer;
        font-size: 1rem;
        min-height: 2.8rem;
        transition: transform 260ms ease, border-color 240ms ease, box-shadow 260ms ease;
      }

      .amount-chip.active {
        background: linear-gradient(135deg, #12a8ff, #2f7cff);
        border-color: #5ec6ff;
        box-shadow: 0 0 16px #1aa7ff55;
      }

      .amount-chip:hover {
        transform: translateY(-1px);
      }

      .amount-chip:focus-visible {
        outline: 2px solid #7ad8ff;
        outline-offset: 2px;
      }

      .contribution-selector label {
        color: #8fb6d9;
        display: block;
        margin-top: 0.75rem;
        margin-bottom: 0.35rem;
      }

      .contribution-selector input {
        width: 100%;
        background: #051c31;
        border: 1px solid #1f4970;
        border-radius: 0.7rem;
        color: #f0f7ff;
        min-height: 2.65rem;
        padding: 0 0.75rem;
      }

      @media (max-width: 600px) {
        .preset-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .amount-chip {
          transition: none;
        }
      }
    `
  ]
})
export class ContributionSelectorComponent {
  readonly amounts = input.required<readonly number[]>();
  readonly label = input.required<string>();
  readonly customAmountLabel = input.required<string>();
  readonly amountSelected = output<number>();

  readonly customId = 'custom-contribution-amount';
  readonly selectedAmount = signal<number>(5);
  readonly customAmountControl = new FormControl<number | null>(null, {
    validators: [Validators.min(1)]
  });
  readonly resolvedAmount = computed<number>(
    () => this.customAmountControl.value ?? this.selectedAmount()
  );

  setPreset(amount: number): void {
    this.selectedAmount.set(amount);
    this.customAmountControl.setValue(null, { emitEvent: false });
    this.amountSelected.emit(amount);
  }

  onCustomAmountInput(): void {
    const value = this.customAmountControl.value;
    if (value && value > 0) {
      this.amountSelected.emit(value);
    }
  }

  isAmountSelected(amount: number): boolean {
    return isPresetSelected(this.selectedAmount(), amount);
  }
}
