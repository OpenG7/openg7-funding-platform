import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

type EditableField = HTMLInputElement | HTMLTextAreaElement;
const supportedTypes = new Set([
  'text',
  'email',
  'url',
  'search',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week'
]);

/** Transient admin presentation molecule: edits one existing field without submitting its form. */
@Component({
  selector: 'openg7-admin-controller-editor',
  standalone: true,
  host: { 'data-og7-controller-global': '' },
  templateUrl: './admin-controller-editor.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-controller-editor.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminControllerEditorComponent {
  readonly target = input<EditableField | null>(null);
  readonly closed = output<void>();
  readonly draft = signal('');
  readonly cursor = signal(0);
  readonly upper = signal(false);
  readonly error = signal('');
  readonly label = signal('');
  readonly fieldType = signal('text');
  readonly keys = Array.from(
    'abcdefghijklmnopqrstuvwxyz0123456789éèêëàâçùûüîïôœæÿ.,:;!?@_/-+%#&=~()[]{}\'"\\|<>$*'
  );
  readonly masked = computed(() => this.fieldType() === 'password');
  readonly before = computed(() =>
    this.masked()
      ? '•'.repeat(this.cursor())
      : this.draft().slice(0, this.cursor())
  );
  readonly after = computed(() =>
    this.masked()
      ? '•'.repeat(this.draft().length - this.cursor())
      : this.draft().slice(this.cursor())
  );
  readonly multiline = computed(() => this.fieldType() === 'textarea');
  readonly format = computed(() => {
    const key = (
      {
        date: 'date',
        time: 'time',
        'datetime-local': 'datetime',
        month: 'month',
        week: 'week',
        number: 'number'
      } as Record<string, string>
    )[this.fieldType()];
    return key ? this.t('formats.' + key) : null;
  });
  private readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private original: EditableField | null = null;
  private initial = '';
  private frame = 0;

  constructor() {
    afterRenderEffect(() => {
      const field = this.target();
      if (field === this.original) return;
      if (!field) {
        this.finish(false);
        return;
      }
      if (!this.editable(field)) {
        this.closed.emit();
        return;
      }
      this.original = field;
      this.initial = field.value;
      this.draft.set(field.value);
      this.cursor.set(field.selectionStart ?? field.value.length);
      this.upper.set(false);
      this.error.set('');
      this.fieldType.set(
        field.tagName === 'TEXTAREA'
          ? 'textarea'
          : (field as HTMLInputElement).type
      );
      this.label.set(
        field.getAttribute('aria-label') ||
          Array.from(field.labels ?? [])
            .map((label) => label.textContent?.trim())
            .filter(Boolean)
            .join(' ') ||
          field.getAttribute('placeholder') ||
          this.t('field')
      );
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      if (!dialog.open) dialog.showModal();
      this.frame =
        this.document.defaultView?.requestAnimationFrame(() => {
          this.frame = 0;
          if (dialog.open && this.original === field)
            dialog
              .querySelector<HTMLButtonElement>('[data-og7="editor-key"]')
              ?.focus();
        }) ?? 0;
    });
    inject(DestroyRef).onDestroy(() => this.finish(false));
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.controller.editor.' + key, params);
  }

  keydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.dialog()?.nativeElement;
    if (!dialog?.open) return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]'
      )
    ).filter(
      (element) =>
        element.getClientRects().length > 0 &&
        !element.closest('[data-og7="virtual-controller"]')
    );
    if (!controls.length) return;
    event.preventDefault();
    event.stopPropagation();
    const current = controls.indexOf(
      this.document.activeElement as HTMLElement
    );
    controls[
      (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    ]?.focus();
  }

  insert(value: string): void {
    const field = this.original;
    if (!field) return;
    const next =
      this.draft().slice(0, this.cursor()) +
      value +
      this.draft().slice(this.cursor());
    if (field.maxLength >= 0 && next.length > field.maxLength) return;
    this.draft.set(next);
    this.cursor.update((position) => position + value.length);
    this.error.set('');
  }
  backspace(): void {
    const position = this.cursor();
    if (!position) return;
    this.draft.update(
      (value) => value.slice(0, position - 1) + value.slice(position)
    );
    this.cursor.set(position - 1);
    this.error.set('');
  }
  clear(): void {
    this.draft.set('');
    this.cursor.set(0);
    this.error.set('');
  }
  move(offset: number): void {
    this.cursor.update((position) =>
      Math.max(0, Math.min(this.draft().length, position + offset))
    );
  }
  cancel(event?: Event): void {
    event?.preventDefault();
    this.finish(true);
  }

  apply(): void {
    const field = this.original;
    if (!field || !this.editable(field)) {
      this.error.set(this.t('unavailable'));
      return;
    }
    if (field.value !== this.initial) {
      this.error.set(this.t('changed'));
      return;
    }
    const probe = field.cloneNode(false) as EditableField;
    probe.value = this.draft();
    const lengthInvalid =
      (field.maxLength >= 0 && this.draft().length > field.maxLength) ||
      (field.minLength > 0 &&
        this.draft().length > 0 &&
        this.draft().length < field.minLength);
    if (
      lengthInvalid ||
      (this.draft().trim() && !probe.value) ||
      !probe.checkValidity()
    ) {
      this.error.set(probe.validationMessage || this.t('invalid'));
      return;
    }
    const prototype =
      field.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      field,
      probe.value
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur'));
    const valid = field.checkValidity();
    this.finish(true);
    if (!valid) field.reportValidity();
  }

  private editable(field: EditableField): boolean {
    return (
      field.isConnected &&
      !field.matches(':disabled') &&
      !field.readOnly &&
      !field.closest(
        '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'
      ) &&
      field.getClientRects().length > 0 &&
      !['hidden', 'collapse'].includes(
        this.document.defaultView?.getComputedStyle(field).visibility ??
          'hidden'
      ) &&
      (field.tagName === 'TEXTAREA' ||
        supportedTypes.has((field as HTMLInputElement).type))
    );
  }
  private finish(emit: boolean): void {
    if (this.frame) this.document.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = 0;
    const field = this.original;
    this.original = null;
    this.initial = '';
    this.draft.set('');
    this.cursor.set(0);
    this.error.set('');
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    if (emit) {
      this.closed.emit();
      if (field?.isConnected) field.focus({ preventScroll: true });
    }
  }
}
