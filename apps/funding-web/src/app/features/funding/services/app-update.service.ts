import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  NgZone,
  afterNextRender,
  computed,
  inject,
  isDevMode,
  signal
} from '@angular/core';

/** Watches the deployed Web bundles without interrupting the current page. */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly detectedVersion = signal<string | null>(null);
  private readonly dismissedVersion = signal<string | null>(null);
  private loadedVersion: string | null = null;
  private request: AbortController | null = null;

  readonly available = computed(
    () =>
      this.detectedVersion() !== null &&
      this.detectedVersion() !== this.dismissedVersion()
  );

  constructor() {
    // Browser only, after hydration; ng serve does not have hashed bundles.
    afterNextRender(() => {
      if (isDevMode()) return;
      this.loadedVersion = this.readVersion(this.document);
      if (!this.loadedVersion) return;

      this.zone.runOutsideAngular(() => {
        const check = () => void this.check();
        const interval = window.setInterval(check, 60_000);
        this.document.addEventListener('visibilitychange', check);
        window.addEventListener('online', check);
        this.destroyRef.onDestroy(() => {
          window.clearInterval(interval);
          this.document.removeEventListener('visibilitychange', check);
          window.removeEventListener('online', check);
          this.request?.abort();
        });
        check();
      });
    });
  }

  dismiss(): void {
    this.dismissedVersion.set(this.detectedVersion());
  }

  refresh(): void {
    this.document.defaultView?.location.reload();
  }

  private async check(): Promise<void> {
    if (
      this.destroyRef.destroyed ||
      this.document.hidden ||
      !window.navigator.onLine ||
      this.request
    )
      return;

    const request = new AbortController();
    this.request = request;
    const timeout = window.setTimeout(() => request.abort(), 10_000);
    try {
      // This small, non-prerendered document shares the public/admin bundles.
      const response = await window.fetch(
        new URL('index.csr.html', this.document.baseURI),
        {
          cache: 'no-store',
          mode: 'same-origin',
          redirect: 'error',
          signal: request.signal
        }
      );
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('text/html')
      )
        return;

      const latest = new DOMParser().parseFromString(
        await response.text(),
        'text/html'
      );
      const version = this.readVersion(latest);
      if (!version || this.destroyRef.destroyed) return;
      this.zone.run(() => {
        this.detectedVersion.set(
          version === this.loadedVersion ? null : version
        );
      });
    } catch {
      // Offline, timeout or incomplete deployment: try again on the next check.
    } finally {
      window.clearTimeout(timeout);
      this.request = null;
    }
  }

  private readVersion(document: Document): string | null {
    if (!document.querySelector('openg7-root')) return null;
    const main = document.querySelector<HTMLScriptElement>(
      'script[type="module"][src*="main-"]'
    );
    const styles = document.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href*="styles-"]'
    );
    const mainPath = main?.getAttribute('src');
    const stylesPath = styles?.getAttribute('href');
    if (
      !mainPath ||
      !stylesPath ||
      !/(?:^|\/)main-[\w-]+\.js$/.test(mainPath) ||
      !/(?:^|\/)styles-[\w-]+\.css$/.test(stylesPath)
    )
      return null;

    return [mainPath, stylesPath]
      .map((path) => new URL(path, this.document.baseURI).href)
      .join('|');
  }
}
