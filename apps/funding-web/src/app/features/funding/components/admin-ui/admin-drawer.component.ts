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
  private releaseModalFocus: (() => boolean) | null = null;

  constructor() {
    afterRenderEffect(() => {
      const element = this.dialog().nativeElement;
      if (this.opened() && !element.open) {
        this.opener = this.document.activeElement as HTMLElement | null;
        this.releaseModalFocus?.();
        this.releaseModalFocus = ownModalFocus(this.document, element);
        try {
          element.showModal();
        } catch (error) {
          this.releaseModalFocus();
          this.releaseModalFocus = null;
          throw error;
        }
        this.closeButton().nativeElement.focus();
      } else if (!this.opened() && (element.open || this.releaseModalFocus)) {
        const restore = this.releaseModalFocus?.() ?? false;
        this.releaseModalFocus = null;
        if (element.open) element.close();
        this.restoreFocus(restore);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      const restore = this.releaseModalFocus?.() ?? false;
      this.releaseModalFocus = null;
      if (this.opener) this.dialog().nativeElement.close();
      this.restoreFocus(restore);
    });
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
        !element.closest('[data-og7="virtual-controller"]') &&
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
      (active === last ||
        !this.dialog().nativeElement.contains(active) ||
        !!active?.closest('[data-og7="virtual-controller"]'))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  private restoreFocus(restore = true): void {
    if (!this.opener) return;
    const opener = this.opener;
    this.opener = null;
    if (!restore) return;
    if (opener.isConnected && !opener.matches(':disabled')) opener.focus();
    else this.document.getElementById('admin-main')?.focus();
  }
}

const modalFocusScopes = new WeakMap<Document, DrawerModalFocusScope>();

/** Native dialogs outside this component, including the controller editor, keep priority. */
class DrawerModalFocusScope {
  readonly owners = new Set<HTMLDialogElement>();
  private stack: HTMLDialogElement[];
  private readonly focused = new WeakMap<HTMLDialogElement, HTMLElement>();
  private restoring = false;

  constructor(private readonly document: Document) {
    this.stack = Array.from(
      document.querySelectorAll<HTMLDialogElement>('dialog:modal')
    );
    const active = document.activeElement as HTMLElement | null;
    const modal = active?.closest<HTMLDialogElement>('dialog:modal');
    if (modal) {
      this.promote(modal);
      this.focused.set(modal, active!);
    }
    document.addEventListener('beforetoggle', this.toggle, true);
    document.addEventListener('focusin', this.focus, true);
  }

  promote(dialog: HTMLDialogElement): void {
    this.stack = this.stack.filter((candidate) => candidate !== dialog);
    this.stack.push(dialog);
  }

  top(): HTMLDialogElement | undefined {
    this.stack = this.stack.filter(
      (dialog) => dialog.isConnected && dialog.open && dialog.matches(':modal')
    );
    return this.stack.at(-1);
  }

  remove(dialog: HTMLDialogElement): void {
    this.stack = this.stack.filter((candidate) => candidate !== dialog);
    this.focused.delete(dialog);
  }

  destroy(): void {
    this.document.removeEventListener('beforetoggle', this.toggle, true);
    this.document.removeEventListener('focusin', this.focus, true);
    this.stack = [];
  }

  private readonly toggle = (event: Event): void => {
    const dialog = event.target as HTMLDialogElement | null;
    if (dialog?.tagName !== 'DIALOG') return;
    if ((event as ToggleEvent).newState === 'open') this.promote(dialog);
    else this.remove(dialog);
  };

  private readonly focus = (event: FocusEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest) return;
    const modal = target.closest<HTMLDialogElement>('dialog:modal');
    // A newly focused native modal also covers engines without beforetoggle.
    if (modal && !this.stack.includes(modal)) this.promote(modal);
    const top = this.top();
    if (!top) return;
    if (top.contains(target)) {
      this.focused.set(top, target);
      return;
    }
    if (this.restoring) return;
    event.stopImmediatePropagation();
    const usable = (element: HTMLElement | undefined): element is HTMLElement =>
      !!element &&
      element.isConnected &&
      top.contains(element) &&
      !element.matches(':disabled') &&
      !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
      element.getClientRects().length > 0;
    const previous = this.focused.get(top);
    const fallback = Array.from(
      top.querySelectorAll<HTMLElement>(
        'button,a[href],input,textarea,select,[tabindex]'
      )
    ).find(usable);
    const restore = usable(previous) ? previous : (fallback ?? top);
    this.restoring = true;
    try {
      restore.focus({ preventScroll: true });
    } finally {
      this.restoring = false;
    }
  };
}

function ownModalFocus(
  document: Document,
  dialog: HTMLDialogElement
): () => boolean {
  let scope = modalFocusScopes.get(document);
  if (!scope) {
    scope = new DrawerModalFocusScope(document);
    modalFocusScopes.set(document, scope);
  }
  scope.owners.add(dialog);
  scope.promote(dialog);
  let released = false;
  return () => {
    if (released) return false;
    released = true;
    const restore = scope.top() === dialog;
    scope.remove(dialog);
    scope.owners.delete(dialog);
    if (!scope.owners.size) {
      scope.destroy();
      modalFocusScopes.delete(document);
    }
    return restore;
  };
}
