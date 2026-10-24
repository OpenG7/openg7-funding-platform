import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { FundingModerationActionsComponent } from '../admin-moderation/funding-moderation-actions.component.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';
import { AdminPublicationNavigationService } from '../../services/admin-publication-navigation.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import type { PublicationDeliveryController } from './publication-delivery-controller.js';
import { PublicationDeliverySecondaryActionsComponent } from './publication-delivery-secondary-actions.component.js';

/** Delivery review organism; its controller retains the exact displayed decision. */
@Component({
  selector: 'openg7-publication-delivery-drawer',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    TranslatePipe,
    AdminDrawerComponent,
    AdminAutomaticPreparationDirective,
    FundingModerationActionsComponent,
    PublicationDeliverySecondaryActionsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './publication-delivery-drawer.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './publication-delivery-drawer.component.css'
  ]
})
export class PublicationDeliveryDrawerComponent {
  readonly controller = input.required<PublicationDeliveryController>();
  readonly navigationNotice = input('');
  private readonly navigation = inject(AdminPublicationNavigationService);
  private readonly admin = inject(FundingAdminService);
  private readonly injector = inject(Injector);
  private readonly previewPanel =
    viewChild<ElementRef<HTMLElement>>('previewPanel');
  private readonly previewToggle =
    viewChild<ElementRef<HTMLButtonElement>>('previewToggle');
  private readonly reviewAuthorization = viewChild<ElementRef<HTMLElement>>(
    'reviewAuthorization'
  );
  private readonly localPreview = viewChild<ElementRef<HTMLDetailsElement>>(
    'localPreviewDetails'
  );
  private localPreviewWasOpen = true;
  readonly previewExpanded = signal(false);
  readonly canWrite = computed(() => this.admin.identity()?.role !== 'reader');
  readonly automaticFor = input<string | null>(null);
  readonly automaticTarget = computed(() => {
    const job = this.controller().selected();
    const contributionId = this.automaticFor();
    if (
      contributionId &&
      job?.sponsors.some((sponsor) => sponsor.id === contributionId)
    )
      return contributionId;
    return job?.sponsors.length === 1 ? job.sponsors[0].id : null;
  });

  constructor() {
    effect((onCleanup) => {
      onCleanup(this.navigation.register(this.controller()));
    });
    effect(() => {
      const controller = this.controller();
      controller.selected();
      controller.composing();
      this.admin.sessionGeneration();
      this.previewExpanded.set(false);
    });
  }

  editorFormId(): string {
    const controller = this.controller();
    return `publication-editor-${controller.selected()?.id ?? 'compose-' + controller.composeFeed}`;
  }

  previewId(): string {
    return this.editorFormId() + '-preview';
  }

  previewFormat() {
    const controller = this.controller();
    return this.canWrite() && controller.editing()
      ? controller.edit.publicationFormat
      : controller.selected()?.publicationFormat;
  }

  returnToReview(): void {
    const controller = this.controller();
    const selected = controller.selected();
    const session = this.admin.sessionGeneration();
    if (
      !this.canWrite() ||
      !selected ||
      controller.busy() ||
      controller.dirty()
    )
      return;
    controller.editing.set(false);
    afterNextRender(
      () => {
        if (
          this.controller() !== controller ||
          controller.selected() !== selected ||
          this.admin.sessionGeneration() !== session ||
          controller.editing() ||
          controller.busy() ||
          this.previewExpanded() ||
          !this.canWrite()
        )
          return;
        const target =
          this.reviewAuthorization()?.nativeElement ??
          this.previewPanel()?.nativeElement;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      },
      { injector: this.injector }
    );
  }

  togglePreview(): void {
    const controller = this.controller();
    if (controller.busy()) return;
    const expanded = !this.previewExpanded();
    const localPreview = this.localPreview()?.nativeElement;
    if (localPreview) {
      if (expanded) this.localPreviewWasOpen = localPreview.open;
      localPreview.open = expanded || this.localPreviewWasOpen;
    }
    this.previewExpanded.set(expanded);
    afterNextRender(
      () => {
        if (
          this.controller() !== controller ||
          this.previewExpanded() !== expanded ||
          (!controller.selected() && !controller.composing())
        )
          return;
        const target = expanded
          ? this.previewPanel()?.nativeElement
          : this.previewToggle()?.nativeElement;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      },
      { injector: this.injector }
    );
  }
}
