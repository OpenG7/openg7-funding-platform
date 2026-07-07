import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { FUNDING_DEFAULT_LANGUAGE } from '@openg7/funding-i18n';

export type FundingLanguage = 'fr-CA' | 'en';
export type FundingCanonicalPath =
  | '/'
  | '/fonds-des-batisseurs'
  | '/ecosystem'
  | '/support'
  | '/music'
  | '/boutique'
  | '/fonds-des-batisseurs/a-propos'
  | '/fonds-des-batisseurs/transparence';

const supportedLanguages: readonly FundingLanguage[] = ['fr-CA', 'en'];
const languageStorageKey = 'openg7.language';
const supportedCanonicalPaths: readonly FundingCanonicalPath[] = [
  '/',
  '/fonds-des-batisseurs',
  '/ecosystem',
  '/support',
  '/music',
  '/boutique',
  '/fonds-des-batisseurs/a-propos',
  '/fonds-des-batisseurs/transparence'
];

@Injectable({ providedIn: 'root' })
export class FundingI18nService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly translationVersion = signal(0);
  readonly currentLanguage = signal<FundingLanguage>(FUNDING_DEFAULT_LANGUAGE);
  readonly currentCanonicalPath = signal<FundingCanonicalPath>('/');

  constructor(private readonly translate: TranslateService) {
    this.translate.setDefaultLang(FUNDING_DEFAULT_LANGUAGE);

    const initialPath = this.resolveCurrentPath();
    const initialLanguage = this.resolveLanguageFromPath(initialPath);
    this.currentCanonicalPath.set(this.toCanonicalPath(initialPath));
    this.translate.use(initialLanguage).subscribe(() => {
      this.currentLanguage.set(initialLanguage);
      this.updateDocumentLanguage(initialLanguage);
      this.translationVersion.update((value) => value + 1);
    });

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.syncLanguageWithPath(event.urlAfterRedirects);
      }
    });
  }

  trackTranslationState(): void {
    this.translationVersion();
  }

  t(key: string): string {
    return this.translate.instant(key);
  }

  setLanguage(language: FundingLanguage): void {
    this.translate.use(language).subscribe(() => {
      this.currentLanguage.set(language);
      this.updateDocumentLanguage(language);
      this.persistLanguage(language);
      this.translationVersion.update((value) => value + 1);
    });
  }

  toggleLanguage(): void {
    this.setLanguage(this.currentLanguage() === 'fr-CA' ? 'en' : 'fr-CA');
  }

  localizedPath(
    path: FundingCanonicalPath,
    language: FundingLanguage = this.currentLanguage()
  ): string {
    return language === 'en' ? `/en${path === '/' ? '' : path}` : path;
  }

  alternateLanguagePath(language: FundingLanguage): string {
    return this.localizedPath(this.currentCanonicalPath(), language);
  }

  canonicalPathForPath(path: string): FundingCanonicalPath {
    return this.toCanonicalPath(path);
  }

  languageForPath(path: string): FundingLanguage {
    return this.resolveLanguageFromPath(path);
  }

  private syncLanguageWithPath(path: string): void {
    const language = this.resolveLanguageFromPath(path);
    this.currentCanonicalPath.set(this.toCanonicalPath(path));

    if (language === this.currentLanguage()) {
      this.updateDocumentLanguage(language);
      return;
    }

    this.setLanguage(language);
  }

  private persistLanguage(language: FundingLanguage): void {
    if (isPlatformBrowser(this.platformId)) {
      window.localStorage.setItem(languageStorageKey, language);
    }
  }

  private updateDocumentLanguage(language: FundingLanguage): void {
    this.document.documentElement.lang = language;
  }

  private resolveCurrentPath(): string {
    if (isPlatformBrowser(this.platformId)) {
      return window.location.pathname;
    }

    return this.router.url || this.document.location?.pathname || '/';
  }

  private resolveLanguageFromPath(path: string): FundingLanguage {
    const normalizedPath = this.normalizePath(path);
    return normalizedPath === '/en' || normalizedPath.startsWith('/en/')
      ? 'en'
      : FUNDING_DEFAULT_LANGUAGE;
  }

  private toCanonicalPath(path: string): FundingCanonicalPath {
    const normalizedPath = this.stripEnglishPrefix(this.normalizePath(path));
    return this.isSupportedCanonicalPath(normalizedPath) ? normalizedPath : '/';
  }

  private normalizePath(path: string): string {
    const pathOnly = path.split(/[?#]/)[0] || '/';
    const withLeadingSlash = pathOnly.startsWith('/')
      ? pathOnly
      : `/${pathOnly}`;
    return withLeadingSlash.length > 1
      ? withLeadingSlash.replace(/\/$/, '')
      : withLeadingSlash;
  }

  private stripEnglishPrefix(path: string): string {
    if (path === '/en') {
      return '/';
    }

    return path.startsWith('/en/') ? path.slice(3) : path;
  }

  private isSupportedCanonicalPath(path: string): path is FundingCanonicalPath {
    return supportedCanonicalPaths.includes(path as FundingCanonicalPath);
  }

  private isSupportedLanguage(
    language: string | null
  ): language is FundingLanguage {
    return supportedLanguages.includes(language as FundingLanguage);
  }
}
