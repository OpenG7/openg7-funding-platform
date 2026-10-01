import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';

export type PilotTheme = 'night' | 'mineral' | 'graphite';
export interface PilotAppearance {
  theme: PilotTheme;
  system: boolean;
  density: 'comfortable' | 'compact';
}

/** Local presentation preferences only; no identity, dossier or API state. */
@Injectable()
export class PilotAppearanceService {
  private readonly document = inject(DOCUMENT);
  private readonly destroy = inject(DestroyRef);
  private readonly storageKey = 'openg7.pilotage.appearance.v1';
  readonly settings = signal<PilotAppearance>({
    theme: 'night',
    system: false,
    density: 'comfortable'
  });
  readonly storageUnavailable = signal(false);
  private readonly dark = signal(true);
  readonly resolved = computed(() =>
    this.settings().system
      ? this.dark()
        ? 'night'
        : 'mineral'
      : this.settings().theme
  );

  constructor() {
    afterNextRender(() => {
      const browser = this.document.defaultView!;
      const media = browser.matchMedia('(prefers-color-scheme: dark)');
      this.dark.set(media.matches);
      try {
        this.read(browser.localStorage.getItem(this.storageKey));
      } catch {
        this.storageUnavailable.set(true);
      }
      this.apply();
      const changed = () => {
        this.dark.set(media.matches);
        this.apply();
      };
      const synchronized = (event: StorageEvent) => {
        if (event.key !== this.storageKey && event.key !== null) return;
        this.read(event.newValue);
        this.apply();
      };
      media.addEventListener('change', changed);
      browser.addEventListener('storage', synchronized);
      this.destroy.onDestroy(() => {
        media.removeEventListener('change', changed);
        browser.removeEventListener('storage', synchronized);
      });
    });
  }
  update(change: Partial<PilotAppearance>): void {
    this.settings.update((value) => ({ ...value, ...change }));
    this.apply();
    try {
      this.document.defaultView!.localStorage.setItem(
        this.storageKey,
        JSON.stringify(this.settings())
      );
      this.storageUnavailable.set(false);
    } catch {
      this.storageUnavailable.set(true);
    }
  }
  private read(raw: string | null): void {
    try {
      const value = JSON.parse(raw || '{}');
      this.settings.set({
        theme: ['night', 'mineral', 'graphite'].includes(value?.theme)
          ? value.theme
          : 'night',
        system: value?.system === true,
        density: value?.density === 'compact' ? 'compact' : 'comfortable'
      });
    } catch {
      this.settings.set({
        theme: 'night',
        system: false,
        density: 'comfortable'
      });
    }
  }
  private apply(): void {
    this.document.documentElement.dataset['og7PilotTheme'] = this.resolved();
    this.document.documentElement.dataset['og7PilotDensity'] =
      this.settings().density;
  }
}
