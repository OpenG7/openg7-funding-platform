import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-site-music',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      *ngIf="isAvailable()"
      type="button"
      class="site-music-toggle"
      [class.playing]="isPlaying()"
      [attr.aria-label]="musicLabel()"
      [attr.aria-pressed]="isPlaying()"
      [attr.title]="musicLabel()"
      (click)="toggleMusic()"
    >
      <span aria-hidden="true">{{ isPlaying() ? '♪' : '♬' }}</span>
    </button>
  `,
  styleUrl: './site-music.component.css'
})
export class SiteMusicComponent implements OnInit, OnDestroy {
  private readonly musicSource =
    'assets/Le%20Gardien%20des%20Lumi%C3%A8res.mp3';
  private readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);

  readonly isAvailable = signal<boolean>(true);
  readonly isPlaying = signal<boolean>(false);
  readonly musicLabel = computed<string>(() => {
    this.i18n.trackTranslationState();
    return this.isPlaying()
      ? this.i18n.t('funding.music.toggle.stop')
      : this.i18n.t('funding.music.toggle.play');
  });

  private audioElement: HTMLAudioElement | null = null;
  private removeUnlockHandlers: (() => void) | null = null;
  private routeSubscription: Subscription | null = null;
  private userPaused = false;

  ngOnInit(): void {
    if (typeof window === 'undefined') {
      this.isAvailable.set(false);
      return;
    }

    this.routeSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.syncRouteState();
      }
    });
    this.syncRouteState();
  }

  ngOnDestroy(): void {
    this.stopMusic();
    this.removeUnlockHandlers?.();
    this.routeSubscription?.unsubscribe();
    this.audioElement = null;
  }

  toggleMusic(): void {
    if (this.isPlaying()) {
      this.userPaused = true;
      this.stopMusic();
      return;
    }

    this.userPaused = false;
    void this.startMusic({ automatic: false });
  }

  private async startMusic(options: {
    readonly automatic: boolean;
  }): Promise<void> {
    const audio = this.ensureAudioElement();
    if (!audio) {
      this.isAvailable.set(false);
      return;
    }

    try {
      this.removeUnlockHandlers?.();
      this.removeUnlockHandlers = null;
      await audio.play();
      this.isPlaying.set(true);
    } catch {
      this.isPlaying.set(false);

      if (options.automatic && !this.userPaused) {
        this.registerUnlockHandlers();
      }
    }
  }

  private stopMusic(): void {
    this.audioElement?.pause();
    this.isPlaying.set(false);
  }

  private ensureAudioElement(): HTMLAudioElement | null {
    if (this.audioElement) {
      return this.audioElement;
    }

    this.audioElement = new Audio(this.musicSource);
    this.audioElement.loop = true;
    this.audioElement.preload = 'auto';
    this.audioElement.volume = 0.42;
    this.audioElement.addEventListener('error', () => {
      this.isAvailable.set(false);
      this.isPlaying.set(false);
    });

    return this.audioElement;
  }

  private syncRouteState(): void {
    if (this.isAdminRoute()) {
      this.isAvailable.set(false);
      this.removeUnlockHandlers?.();
      this.removeUnlockHandlers = null;
      this.stopMusic();
      return;
    }

    this.isAvailable.set(true);

    if (this.isAutomaticStartSuppressedRoute()) {
      this.removeUnlockHandlers?.();
      this.removeUnlockHandlers = null;
      return;
    }

    if (!this.userPaused && !this.isPlaying()) {
      void this.startMusic({ automatic: true });
    }
  }

  private isAutomaticStartSuppressedRoute(): boolean {
    return [this.router.url, window.location.pathname].some((path) =>
      ['/music', '/boutique'].includes(
        this.i18n.canonicalPathForPath(this.normalizedPath(path))
      )
    );
  }

  private isAdminRoute(): boolean {
    const routerPath = this.normalizedPath(this.router.url);
    const browserPath = this.normalizedPath(window.location.pathname);
    return (
      routerPath === '/admin' ||
      routerPath.startsWith('/admin/') ||
      browserPath === '/admin' ||
      browserPath.startsWith('/admin/')
    );
  }

  private normalizedPath(path: string): string {
    const normalized = path.split(/[?#]/)[0].replace(/\/+$/, '');
    return normalized || '/';
  }

  private registerUnlockHandlers(): void {
    if (this.removeUnlockHandlers) {
      return;
    }

    const unlock = (): void => {
      this.removeUnlockHandlers?.();
      this.removeUnlockHandlers = null;
      void this.startMusic({ automatic: false });
    };

    window.addEventListener('pointerdown', unlock, {
      once: true,
      passive: true
    });
    window.addEventListener('keydown', unlock, { once: true });
    this.removeUnlockHandlers = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }
}
