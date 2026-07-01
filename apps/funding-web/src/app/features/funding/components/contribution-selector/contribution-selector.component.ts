import { CommonModule } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'openg7-contribution-selector',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <fieldset>
      <legend>{{ label() }}</legend>
      <button
        type="button"
        *ngFor="let amount of amounts()"
        (click)="setPreset(amount)"
      >
        {{ amount }} CAD
      </button>
      <label [attr.for]="customId">{{ customAmountLabel() }}</label>
      <input
        [id]="customId"
        type="number"
        [formControl]="customAmountControl"
        inputmode="numeric"
        min="1"
        step="1"
      />
    </fieldset>
  `
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
    this.amountSelected.emit(amount);
  }
}
