import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal
} from '@angular/core';

import { ServiceDemoLinkDirective as RouterLink } from './service-demo-link.directive.js';

export interface DossierMediaPreview {
  readonly src: string;
  readonly thumbnailSrc?: string;
}

/** A local presentation molecule; its caller supplies only already accessible media. */
@Component({
  selector: 'openg7-dossier-media-preview',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dossier-media-preview.component.html',
  styleUrl: './dossier-media-preview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-og7': 'dossier-media-preview',
    '[attr.hidden]': 'sources().length ? null : ""',
    '[style.display]': 'sources().length ? null : "none"'
  }
})
export class DossierMediaPreviewComponent {
  readonly media = input<readonly DossierMediaPreview[]>([]);
  readonly href = input.required<string>();
  readonly label = input.required<string>();
  private readonly failedSources = signal<ReadonlySet<string>>(new Set());
  readonly sources = computed(() => {
    const failed = this.failedSources();
    const sources = this.media().map(
      (media) => media.thumbnailSrc?.trim() || media.src.trim()
    );
    return [...new Set(sources)].filter(
      (source) => source.length > 0 && !failed.has(source)
    );
  });
  readonly previews = computed(() => this.sources().slice(0, 3));
  readonly capacities = [1, 2, 3] as const;

  imageFailed(source: string): void {
    this.failedSources.update((failed) => new Set([...failed, source]));
  }
}
