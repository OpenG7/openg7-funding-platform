import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { FundingI18nService, FundingLanguage } from './funding-i18n.service.js';

interface FundingSeoConfig {
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly path: string;
  readonly imagePath: string;
}

const siteOrigin = 'https://openg7.org';

@Injectable({ providedIn: 'root' })
export class FundingSeoService {
  private readonly document = inject(DOCUMENT);
  private readonly i18n = inject(FundingI18nService);
  private readonly meta = inject(Meta);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  bind(config: FundingSeoConfig, injector: Injector): void {
    effect(
      () => {
        this.i18n.trackTranslationState();

        const pageTitle = this.i18n.t(config.titleKey);
        const description = this.i18n.t(config.descriptionKey);
        const canonicalPath = this.i18n.canonicalPathForPath(config.path);
        const routeLanguage = this.getActiveRouteLanguage();
        const renderPath =
          this.router.url || this.document.location?.pathname || '';
        const pathLanguage = this.i18n.languageForPath(renderPath);
        const currentLanguage = this.isFundingLanguage(routeLanguage)
          ? routeLanguage
          : pathLanguage === 'en'
            ? 'en'
            : this.i18n.currentLanguage();
        const localizedPath = this.i18n.localizedPath(
          canonicalPath,
          currentLanguage
        );
        const canonicalUrl = `${siteOrigin}${localizedPath}`;
        const imageUrl = `${siteOrigin}${config.imagePath}`;
        const frenchUrl = `${siteOrigin}${this.i18n.localizedPath(
          canonicalPath,
          'fr-CA'
        )}`;
        const englishUrl = `${siteOrigin}${this.i18n.localizedPath(
          canonicalPath,
          'en'
        )}`;

        this.title.setTitle(pageTitle);
        this.meta.updateTag({ name: 'description', content: description });
        this.meta.updateTag({ property: 'og:title', content: pageTitle });
        this.meta.updateTag({
          property: 'og:description',
          content: description
        });
        this.meta.updateTag({ property: 'og:type', content: 'website' });
        this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
        this.meta.updateTag({ property: 'og:image', content: imageUrl });
        this.meta.updateTag({
          property: 'og:locale',
          content: currentLanguage === 'en' ? 'en_CA' : 'fr_CA'
        });
        this.meta.updateTag({
          name: 'twitter:card',
          content: 'summary_large_image'
        });
        this.setCanonicalUrl(canonicalUrl);
        this.setAlternateUrl('fr-CA', frenchUrl);
        this.setAlternateUrl('en', englishUrl);
        this.setAlternateUrl('x-default', frenchUrl);
      },
      { injector }
    );
  }

  private setCanonicalUrl(url: string): void {
    let canonical = this.document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );

    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.rel = 'canonical';
      this.document.head.appendChild(canonical);
    }

    canonical.href = url;
  }

  private setAlternateUrl(language: string, url: string): void {
    let alternate = this.document.querySelector<HTMLLinkElement>(
      `link[rel="alternate"][hreflang="${language}"]`
    );

    if (!alternate) {
      alternate = this.document.createElement('link');
      alternate.rel = 'alternate';
      alternate.hreflang = language;
      this.document.head.appendChild(alternate);
    }

    alternate.href = url;
  }

  private isFundingLanguage(language: unknown): language is FundingLanguage {
    return language === 'fr-CA' || language === 'en';
  }

  private getActiveRouteLanguage(): FundingLanguage | null {
    let route = this.router.routerState.snapshot.root;

    while (route.firstChild) {
      route = route.firstChild;
    }

    const language = route.data['language'];
    return this.isFundingLanguage(language) ? language : null;
  }
}
