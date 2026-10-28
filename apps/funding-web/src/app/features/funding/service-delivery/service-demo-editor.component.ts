import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminIconComponent } from '../components/admin-ui/admin-icon.component.js';
import { FundingI18nService } from '../services/funding-i18n.service.js';

import en from './i18n/service-demo-editor.en.json' with { type: 'json' };
import fr from './i18n/service-demo-editor.fr-CA.json' with { type: 'json' };
import { ServiceDemoLinkDirective as RouterLink } from './service-demo-link.directive.js';
import { ServiceDemoNavigation } from './service-demo-navigation.js';
import { ServiceDemoState } from './service-demo-state.js';
import { ServiceDemoActionsDirective } from './service-demo-actions.directive.js';
import { ServiceDemoPreviewComponent } from './service-demo-preview.component.js';
import { ServiceDemoTabsDirective } from './service-demo-tabs.directive.js';
import { ServiceDemoTransitionDirective } from './service-demo-transition.directive.js';

/** Browser-local draft editor. It never grants authorization or publishes content. */
@Component({
  selector: 'openg7-service-demo-editor',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    ServiceDemoPreviewComponent,
    ServiceDemoActionsDirective,
    ServiceDemoTabsDirective,
    ServiceDemoTransitionDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './service-demo-editor.component.html',
  styles: [
    `
      :host {
        display: block;
      }
      .editor-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 24px;
      }
      .editor-tabs a {
        flex: 1;
        justify-content: center;
      }
      .editor-count {
        display: block;
        margin: 8px 0 20px;
        text-align: right;
      }
      .editor-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }
      .editor-toggle {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin: 20px 0;
      }
      .editor-toggle input {
        margin-top: 5px;
        accent-color: #075dde;
      }
      .editor-field {
        display: grid;
        gap: 8px;
        margin-bottom: 20px;
      }
      .editor-field textarea {
        min-height: 192px;
        resize: vertical;
      }
      .editor-field input,
      .editor-field textarea {
        width: 100%;
        box-sizing: border-box;
      }
      .editor-preview-note {
        margin-top: 16px;
      }
      .editor-image {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: 12px;
        margin-bottom: 16px;
      }
      .image-choices {
        border: 0;
        padding: 0;
        margin: 20px 0;
      }
      .image-choices legend {
        font-weight: 600;
        margin-bottom: 10px;
      }
      .image-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .image-choice {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        border: 1px solid #dce5ef;
        border-radius: 10px;
        padding: 10px;
        cursor: pointer;
        min-height: 44px;
      }
      .image-choice:has(input:checked) {
        border-color: #075dde;
        background: #ecf4ff;
      }
      .image-choice img {
        grid-column: 1 / -1;
        width: 100%;
        height: 90px;
        object-fit: cover;
        border-radius: 6px;
      }
      .image-choice span {
        font-size: 13px;
      }
      .image-choice input {
        accent-color: #075dde;
      }
      .editor-validation {
        color: #9c2536;
        font-size: 13px;
      }
      .editor-empty {
        padding: 12px;
        border-radius: 8px;
        background: #f4f7fb;
        color: #52647a;
        font-size: 13px;
        margin-top: 8px;
      }
      .editor-save-feedback {
        align-items: center;
      }
      .editor-save-check {
        flex: 0 0 auto;
        width: 20px;
        height: 20px;
      }
      .editor-save-check path {
        stroke-dasharray: 1;
        stroke-dashoffset: 0;
      }
      @media (prefers-reduced-motion: no-preference) {
        .editor-save-feedback {
          animation: editor-save-confirm 240ms ease-out;
        }
        .editor-save-check path {
          animation: editor-save-draw 200ms ease-out 30ms both;
        }
        @keyframes editor-save-confirm {
          from {
            background-color: #d8f1e2;
            box-shadow: 0 0 0 3px #d8f1e2;
          }
          to {
            background-color: #eff8f2;
            box-shadow: 0 0 0 0 transparent;
          }
        }
        @keyframes editor-save-draw {
          from {
            stroke-dashoffset: 1;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
      }
      @media (max-width: 380px) {
        .image-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class ServiceDemoEditorComponent {
  readonly state = inject(ServiceDemoState);
  private readonly navigation = inject(ServiceDemoNavigation);
  private readonly params = this.navigation.params;
  private readonly query = this.navigation.query;
  readonly tab = computed(() => this.params().get('tab') ?? 'texte');
  readonly returnPage = computed(() => {
    const destination = this.query().get('retour');
    return destination &&
      ['contenu', 'autorisation', 'publication'].includes(destination)
      ? destination
      : 'contenu';
  });
  readonly tabs = ['texte', 'image', 'liens', 'mentions', 'options'] as const;
  readonly mention = this.state.mention;
  readonly showLink = this.state.showLink;
  private readonly segmenter = new Intl.Segmenter('fr-CA', {
    granularity: 'grapheme'
  });
  readonly characterCount = computed(
    () => Array.from(this.segmenter.segment(this.state.text())).length
  );
  readonly linkInvalid = computed(() => {
    if (!this.state.link().trim()) return false;
    try {
      return !['https:', 'http:'].includes(
        new URL(this.state.link().trim()).protocol
      );
    } catch {
      return true;
    }
  });

  constructor() {
    const i18n = inject(FundingI18nService);
    i18n.mergeTranslations('fr-CA', fr);
    i18n.mergeTranslations('en', en);
    if (!this.state.text() && !this.state.textEdited()) {
      this.state.text.set(
        i18n.t('serviceDemo.preview.text', { name: this.state.dossier().name })
      );
    }
  }

  changeText(value: string): void {
    this.state.text.set(value);
    this.state.textEdited.set(true);
    this.state.saved.set(false);
    this.state.dirty.set(true);
  }

  changeLink(value: string): void {
    this.state.link.set(value);
    this.state.saved.set(false);
    this.state.dirty.set(true);
  }

  chooseImage(value: 'panorama' | 'companion'): void {
    this.state.imageAsset.set(value);
    this.state.markEdited();
  }
}
