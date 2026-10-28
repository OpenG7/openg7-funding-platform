import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import en from './i18n/service-demo-preview.en.json' with { type: 'json' };
import fr from './i18n/service-demo-preview.fr-CA.json' with { type: 'json' };
import { ServiceDemoLinkDirective as RouterLink } from './service-demo-link.directive.js';
import { ServiceDemoState } from './service-demo-state.js';
import { ServiceDemoTabsDirective } from './service-demo-tabs.directive.js';
import { ServiceDemoTransitionDirective } from './service-demo-transition.directive.js';

@Component({
  selector: 'openg7-service-demo-preview',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    ServiceDemoTabsDirective,
    ServiceDemoTransitionDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './service-demo-preview.component.css',
  template: `
    <section
      class="preview"
      [attr.aria-label]="
        (kind() === 'web'
          ? 'serviceDemoPreview.webTitle'
          : 'serviceDemo.preview.title'
        ) | translate
      "
      data-og7="service-demo-preview"
      [attr.data-og7-id]="kind()"
    >
      <header class="preview-heading">
        <h2>
          {{
            (kind() === 'web'
              ? 'serviceDemoPreview.webTitle'
              : 'serviceDemo.preview.title'
            ) | translate
          }}
        </h2>
        @if (kind() === 'facebook') {
          <span class="channel"
            ><span aria-hidden="true" class="channel-mark">f</span>
            <span>Facebook</span></span
          >
        } @else {
          <span class="web-channel">{{
            'serviceDemoPreview.webChannel' | translate
          }}</span>
        }
      </header>
      <div
        class="preview-modes"
        openg7ServiceDemoTabs
        role="group"
        [attr.aria-label]="'serviceDemoPreview.modeLabel' | translate"
      >
        @for (mode of modes; track mode) {
          <button
            type="button"
            [class.selected]="state.previewMode() === mode"
            [attr.aria-pressed]="state.previewMode() === mode"
            (click)="state.previewMode.set(mode)"
            data-og7="service-demo-preview-mode"
            [attr.data-og7-id]="mode"
          >
            <span [class]="'device-mark ' + mode" aria-hidden="true"></span>
            {{ 'serviceDemoPreview.modes.' + mode | translate }}
          </button>
        }
      </div>
      <div
        class="preview-canvas"
        [class.compact]="state.previewMode() === 'compact'"
        [openg7ServiceDemoTransition]="transitionKey()"
      >
        @if (kind() === 'facebook') {
          <article class="post">
            <header class="post-author">
              <span class="post-avatar" aria-hidden="true"
                >G<span>7</span></span
              >
              <div>
                <strong>OpenG7</strong
                ><small>{{ 'serviceDemo.preview.label' | translate }}</small>
              </div>
            </header>
            @if (text().trim()) {
              <p class="post-text">{{ text() }}</p>
            } @else {
              <p class="empty-copy" data-og7="service-demo-preview-empty">
                {{ 'serviceDemoPreview.emptyText' | translate }}
              </p>
            }
            @if (state.mention()) {
              <p class="post-mention">{{ state.mention() }}</p>
            }
            @if (state.imageIncluded()) {
              <img
                [src]="state.previewImage()"
                width="960"
                height="540"
                [alt]="imageAlt()"
              />
            }
            @if (state.showLink()) {
              <div class="post-link">
                <small>{{
                  'serviceDemo.contentChecks.link.title' | translate
                }}</small>
                <strong>{{ state.dossier().name }}</strong>
                <span>{{ state.link() }}</span>
              </div>
            }
          </article>
        } @else {
          <article class="web-card">
            <header class="web-masthead">
              <strong>OpenG7<span aria-hidden="true">.</span></strong>
              <span>{{ 'serviceDemoPreview.partners' | translate }}</span>
            </header>
            @if (state.imageIncluded()) {
              <img
                [src]="state.previewImage()"
                width="960"
                height="540"
                [alt]="imageAlt()"
              />
            }
            <div class="web-copy">
              <span class="web-eyebrow">{{
                'serviceDemoPreview.partnerLabel' | translate
              }}</span>
              <h3>{{ state.dossier().name }}</h3>
              @if (text().trim()) {
                <p class="web-description">{{ text() }}</p>
              } @else {
                <p class="empty-copy" data-og7="service-demo-preview-empty">
                  {{ 'serviceDemoPreview.emptyText' | translate }}
                </p>
              }
              @if (state.mention()) {
                <p class="web-mention">{{ state.mention() }}</p>
              }
              @if (state.showLink()) {
                <div class="web-destination">
                  <small>{{ 'serviceDemoPreview.website' | translate }}</small>
                  <span>{{ state.link() }}</span>
                </div>
              }
            </div>
          </article>
        }
      </div>
      <p class="preview-caption">
        {{ 'serviceDemo.preview.caption' | translate }}
      </p>
      @if (state.page() !== 'apercu') {
        <a
          class="text-link"
          [routerLink]="state.href('apercu')"
          [queryParams]="{ origine: state.previewOrigin() }"
          queryParamsHandling="merge"
          >{{ 'serviceDemo.preview.open' | translate }}
          <span aria-hidden="true">↗</span></a
        >
      }
    </section>
  `
})
export class ServiceDemoPreviewComponent {
  readonly state = inject(ServiceDemoState);
  readonly kind = input<'facebook' | 'web'>('facebook');
  readonly modes = ['standard', 'compact'] as const;
  readonly transitionKey = computed(() =>
    [
      this.kind(),
      this.state.previewMode(),
      this.state.imageIncluded(),
      this.state.imageAsset()
    ].join(':')
  );
  readonly text = computed(() =>
    this.state.text() || this.state.textEdited()
      ? this.state.text()
      : this.state.i18n.t('serviceDemo.preview.text', {
          name: this.state.dossier().name
        })
  );
  readonly imageAlt = computed(
    () =>
      this.state.imageAlt().trim() ||
      this.state.i18n.t(
        this.state.imageAsset() === 'companion'
          ? 'serviceDemoPreview.companionAlt'
          : 'serviceDemo.preview.imageAlt'
      )
  );

  constructor() {
    this.state.i18n.mergeTranslations('fr-CA', fr);
    this.state.i18n.mergeTranslations('en', en);
  }
}
