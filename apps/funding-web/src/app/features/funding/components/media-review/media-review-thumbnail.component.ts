import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterRenderEffect,
  computed,
  inject,
  input
} from '@angular/core';

import type { MediaPreviewCollection } from './media-preview-collection.js';

/** Lazy presentation only; private loading and its concurrency belong to the workspace. */
@Component({
  selector: 'openg7-media-review-thumbnail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (preview()?.url; as url) {
      <img [src]="url" [alt]="alt()" loading="lazy" decoding="async" />
    } @else {
      <span aria-hidden="true">{{ preview()?.failed ? '—' : '◇' }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        min-height: 6rem;
        background: var(--admin-subtle);
        color: var(--admin-muted);
      }
      img {
        display: block;
        width: 100%;
        height: 100%;
        max-height: 14rem;
        object-fit: contain;
      }
    `
  ]
})
export class MediaReviewThumbnailComponent {
  readonly assetId = input.required<string>();
  readonly version = input.required<string>();
  readonly alt = input('');
  readonly collection = input.required<MediaPreviewCollection>();
  readonly preview = computed(
    () =>
      this.collection().previews()[
        this.collection().key(this.assetId(), this.version())
      ]
  );
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer: IntersectionObserver | null = null;

  constructor() {
    afterRenderEffect(() => {
      const collection = this.collection(),
        id = this.assetId(),
        version = this.version();
      this.observer?.disconnect();
      if (!this.browser) return;
      if (typeof IntersectionObserver === 'undefined') {
        collection.request(id, version);
        return;
      }
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            collection.request(id, version);
            this.observer?.disconnect();
          }
        },
        { rootMargin: '200px' }
      );
      this.observer.observe(this.element.nativeElement);
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }
}
