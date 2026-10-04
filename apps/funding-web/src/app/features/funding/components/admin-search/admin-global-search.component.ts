import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import { AdminGlobalSearchController } from './admin-global-search-controller.js';

/** Admin organism: private, transient search and navigation to existing dossier pages. */
@Component({
  selector: 'openg7-admin-global-search',
  standalone: true,
  imports: [RouterLink, TranslatePipe, AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'shortcut($event)' },
  templateUrl: './admin-global-search.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-global-search.component.css'
  ]
})
export class AdminGlobalSearchComponent {
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly i18n = inject(FundingI18nService);
  readonly inspection = inject(AdminInspectionService);
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input =
    viewChild.required<ElementRef<HTMLInputElement>>('input');
  private opener: HTMLElement | null = null;
  private readonly searchController = new AdminGlobalSearchController({
    admin: {
      search: (token, query, signal) => this.admin.search(token, query, signal)
    },
    token: () => this.admin.getSavedAdminToken(),
    onSessionExpired: async () => {
      this.close();
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
      });
    }
  });
  readonly opened = signal(false);
  readonly query = this.searchController.query;
  readonly result = this.searchController.result;
  readonly state = this.searchController.state;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.searchController.dispose());
  }

  shortcut(event: KeyboardEvent): void {
    if (!this.opened() && this.document.querySelector('dialog[open]')) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.isComposing &&
      event.key.toLowerCase() === 'k'
    ) {
      event.preventDefault();
      if (!event.repeat) this.open();
    }
  }

  open(): void {
    if (!this.browser) return;
    if (!this.opened()) {
      this.opener = this.document.activeElement as HTMLElement | null;
      this.opened.set(true);
      this.dialog().nativeElement.showModal();
    }
    this.input().nativeElement.focus();
  }

  close(event?: Event): void {
    event?.preventDefault();
    this.searchController.clear();
    this.opened.set(false);
    this.dialog().nativeElement.close();
    this.opener?.focus();
  }

  changed(value: string): void {
    this.searchController.changed(value);
  }

  search(page = 1): Promise<void> {
    return this.searchController.search(page);
  }

  keydown(event: KeyboardEvent): void {
    // Do not let the enclosing legacy navigation handle Escape.
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close(event);
      return;
    }
    if (event.key === 'Tab') {
      const controls = Array.from(
        this.dialog().nativeElement.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, a[href]'
        )
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = this.document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !controls.includes(active as HTMLElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.isComposing)
      return;
    const links = Array.from(
      this.dialog().nativeElement.querySelectorAll<HTMLAnchorElement>(
        '[data-og7="search-result-link"]'
      )
    );
    if (!links.length) return;
    event.preventDefault();
    const index = links.indexOf(
      this.document.activeElement as HTMLAnchorElement
    );
    const next =
      index < 0
        ? event.key === 'ArrowDown'
          ? 0
          : links.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) %
          links.length;
    links[next]?.focus();
  }

  amount(minor: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(minor / 100);
  }
}
