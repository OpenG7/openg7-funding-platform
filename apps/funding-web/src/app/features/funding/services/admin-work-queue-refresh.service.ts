import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  effect,
  inject,
  untracked
} from '@angular/core';
import { Router } from '@angular/router';

import { FundingAdminService } from './funding-admin.service.js';

const REFRESH_INTERVAL_MS = 30_000;

/** Share one foreground refresh between the visible queue and navigation counters. */
@Injectable({ providedIn: 'root' })
export class AdminWorkQueueRefreshService {
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly clients = new Map<symbol, (() => Promise<void>) | null>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private lastStarted: number | null = null;
  private session = this.contextKey();
  private readonly wake = () => {
    if (this.document.visibilityState === 'hidden') this.stopTimer();
    else void this.poll();
  };

  constructor() {
    effect(() => {
      const session = this.contextKey();
      if (session === this.session) return;
      this.session = session;
      this.lastStarted = null;
      untracked(() => {
        if (!this.clients.size) return;
        if (!this.admin.hasValidAdminSession()) {
          this.stopTimer();
          // Queue panels own their redirect; navigation-only readers need
          // the same expiry handling without obscuring mutation feedback.
          if (
            ![...this.clients.values()].some((reader) => reader !== null) &&
            /^\/admin\/fundraiser(?:[/?#]|$)/.test(this.router.url)
          )
            void this.router.navigate(['/admin/login'], {
              queryParams: {
                returnUrl: this.router.url,
                sessionExpired: '1'
              }
            });
          return;
        }
        this.wake();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.clients.clear();
      this.stop();
    });
  }

  connect(refresh?: () => Promise<void>): () => void {
    if (!this.browser) return () => {};
    const key = Symbol();
    this.clients.set(key, refresh ?? null);
    if (this.clients.size === 1) {
      this.document.addEventListener('visibilitychange', this.wake);
      this.document.defaultView?.addEventListener('focus', this.wake);
      this.schedule();
    }
    return () => {
      this.clients.delete(key);
      if (!this.clients.size) this.stop();
    };
  }

  private contextKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
  }

  private schedule(): void {
    this.stopTimer();
    if (
      this.clients.size &&
      this.admin.hasValidAdminSession() &&
      this.document.visibilityState !== 'hidden'
    )
      this.timer = setTimeout(() => void this.poll(), REFRESH_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (
      !this.clients.size ||
      this.document.visibilityState === 'hidden' ||
      this.busy ||
      !this.admin.hasValidAdminSession()
    )
      return;
    if (this.lastStarted !== null && Date.now() - this.lastStarted < 1000) {
      this.schedule();
      return;
    }
    this.stopTimer();
    this.lastStarted = Date.now();
    this.busy = true;
    try {
      const readers = [...this.clients.values()].filter(
        (reader): reader is () => Promise<void> => reader !== null
      );
      if (readers.length)
        await Promise.allSettled(readers.map((reader) => reader()));
      else if (this.admin.hasValidAdminSession())
        await this.admin.refreshWorkQueue();
      else this.admin.workQueue.set(null);
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  private stopTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private stop(): void {
    this.stopTimer();
    this.document.removeEventListener('visibilitychange', this.wake);
    this.document.defaultView?.removeEventListener('focus', this.wake);
  }
}
