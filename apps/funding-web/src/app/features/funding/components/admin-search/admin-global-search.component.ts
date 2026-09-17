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
import type { AdminSearchResponse } from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

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
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input =
    viewChild.required<ElementRef<HTMLInputElement>>('input');
  private opener: HTMLElement | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private generation = 0;
  readonly opened = signal(false);
  readonly query = signal('');
  readonly result = signal<AdminSearchResponse | null>(null);
  readonly state = signal<
    | 'idle'
    | 'loading'
    | 'ready'
    | 'error'
    | 'forbidden'
    | 'limited'
    | 'unavailable'
  >('idle');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  shortcut(event: KeyboardEvent): void {
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
    this.cancel();
    this.opened.set(false);
    this.query.set('');
    this.result.set(null);
    this.state.set('idle');
    this.dialog().nativeElement.close();
    this.opener?.focus();
  }

  changed(value: string): void {
    this.cancel();
    this.query.set(value);
    this.result.set(null);
    if (value.trim().length < 2) {
      this.state.set('idle');
      return;
    }
    this.state.set('loading');
    this.timer = setTimeout(() => void this.search(1), 300);
  }

  async search(page = 1): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.result.set(null);
    this.state.set('loading');
    const token = this.admin.getSavedAdminToken();
    try {
      if (!token) throw new AdminDashboardRequestError(401);
      const response = await this.admin.search(
        token,
        { query: this.query().trim(), page, pageSize: 10 },
        controller.signal
      );
      if (generation !== this.generation) return;
      if (!this.admin.getSavedAdminToken())
        throw new AdminDashboardRequestError(401);
      this.result.set(response);
      this.state.set(response.available ? 'ready' : 'unavailable');
    } catch (error) {
      if (generation !== this.generation) return;
      this.result.set(null);
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401) {
        this.close();
        this.admin.clearAdminSession();
        await this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: '/admin/fundraiser' }
        });
      } else
        this.state.set(
          status === 403 ? 'forbidden' : status === 429 ? 'limited' : 'error'
        );
    }
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

  private cancel(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
}
