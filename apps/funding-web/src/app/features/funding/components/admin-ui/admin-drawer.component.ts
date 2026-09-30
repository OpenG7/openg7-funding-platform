import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';

/** Presentation molecule: accessible modal shell, with no router or business client. */
@Component({
  selector: 'openg7-admin-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      [attr.aria-label]="title()"
      [class.wide]="wide()"
      [class.fixed-footer]="fixedFooter()"
      (cancel)="requestClose($event)"
      (keydown)="keydown($event)"
      data-og7="admin-drawer"
    >
      <header>
        <h2>{{ title() }}</h2>
        <button
          #close
          type="button"
          class="admin-button"
          [disabled]="busy()"
          [attr.aria-label]="closeLabel()"
          (click)="requestClose()"
        >
          ×
        </button>
      </header>
      <div
        class="body"
        [attr.aria-busy]="busy()"
        [attr.tabindex]="fixedFooter() ? 0 : null"
        [attr.role]="fixedFooter() ? 'region' : null"
        [attr.aria-label]="fixedFooter() ? title() : null"
        data-og7="admin-drawer-content"
      >
        <ng-content />
      </div>
      <ng-content select="[adminDrawerFooter]" />
    </dialog>
  `,
  styleUrls: [
    './admin-theme.css',
    './admin-controls.css',
    './admin-drawer.component.css'
  ]
})
export class AdminDrawerComponent {
  readonly opened = input(false);
  readonly title = input.required<string>();
  readonly closeLabel = input.required<string>();
  readonly busy = input(false);
  readonly wide = input(false);
  readonly fixedFooter = input(false);
  readonly closed = output<void>();
  private readonly document = inject(DOCUMENT);
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly closeButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('close');
  private opener: HTMLElement | null = null;

  constructor() {
    afterRenderEffect(() => {
      const element = this.dialog().nativeElement;
      if (this.opened() && !element.open) {
        this.opener = this.document.activeElement as HTMLElement | null;
        element.showModal();
        this.closeButton().nativeElement.focus();
      } else if (!this.opened() && element.open) {
        element.close();
        this.restoreFocus();
      }
    });
    inject(DestroyRef).onDestroy(() => this.restoreFocus());
  }

  requestClose(event?: Event): void {
    event?.preventDefault();
    if (!this.busy()) this.closed.emit();
  }

  keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.requestClose(event);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      this.dialog().nativeElement.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, summary, [tabindex]'
      )
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.getClientRects().length > 0
    );
    const first = controls[0],
      last = controls[controls.length - 1];
    const active = this.document.activeElement;
    if (!first) {
      event.preventDefault();
      this.dialog().nativeElement.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (active === last || !controls.includes(active as HTMLElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  private restoreFocus(): void {
    if (!this.opener) return;
    if (this.opener.isConnected && !this.opener.matches(':disabled'))
      this.opener.focus();
    else this.document.getElementById('admin-main')?.focus();
    this.opener = null;
  }
}
