import { Injectable, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';

/** One explicit decision at a time. Navigation always cancels pending actions. */
@Injectable({ providedIn: 'root' })
export class AdminConfirmationService {
  readonly pending = signal<{ message: string; target: string } | null>(null);
  private resolve: ((accepted: boolean) => void) | null = null;

  constructor() {
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) this.answer(false);
    });
  }

  confirm(message: string, target = ''): Promise<boolean> {
    if (this.pending()) return Promise.resolve(false);
    this.pending.set({ message, target });
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  answer(accepted: boolean): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.pending.set(null);
    resolve?.(accepted);
  }
}
