import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminAssistantDraftType } from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import {
  AdminAssistantContextController,
  AssistantContextNavigation
} from './admin-assistant-context-controller.js';
import type { AssistantContextSnapshot } from './admin-assistant-context-controller.js';
import { AdminAssistantDraftComponent } from './admin-assistant-draft.component.js';
import { AdminAssistantAnswerComponent } from './admin-assistant-answer.component.js';

/** Funding organism: dossier presentation, navigation and explicit confirmation UI. */
@Component({
  selector: 'openg7-admin-assistant-context',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    AdminAssistantDraftComponent,
    AdminAssistantAnswerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-context.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-assistant.css'
  ]
})
export class AdminAssistantContextComponent implements OnInit, OnChanges {
  readonly compact = input(false);
  readonly inlineDossier = input(false);
  readonly showWorkspaceLink = input(true);
  readonly dossierOpen = output<void>();
  readonly sponsorshipId = input<string>();
  readonly refreshKey = input<unknown>(0);
  readonly dialog =
    viewChild<ElementRef<HTMLDialogElement>>('confirmationDialog');
  readonly router = inject(Router);
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy = inject(DestroyRef);
  private readonly controller = new AdminAssistantContextController({
    sponsorshipId: () => this.sponsorshipId(),
    hasValidSession: () => this.admin.hasValidAdminSession(),
    token: () => this.admin.getSavedAdminToken(),
    canPrepare: () => this.admin.identity()?.role !== 'reader',
    sessionGeneration: () => this.admin.sessionGeneration(),
    identityId: () => this.admin.identity()?.id ?? null,
    isDestroyed: () => this.destroy.destroyed,
    language: () => this.i18n.currentLanguage(),
    getAssistantContext: (token, id) =>
      this.admin.getAssistantContext(token, id),
    prepareAssistantDraft: (token, payload) =>
      this.admin.prepareAssistantDraft(token, payload),
    queryAssistant: (token, payload) =>
      this.admin.queryAssistant(token, payload),
    requestSponsorshipInformation: (token, payload) =>
      this.admin.requestSponsorshipInformation(token, payload),
    refreshWorkQueue: () => this.admin.refreshWorkQueue(),
    onUnauthorized: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    },
    closeConfirmation: () => this.dialog()?.nativeElement.close(),
    openConfirmation: () => this.dialog()?.nativeElement.showModal()
  });
  readonly data = this.controller.data;
  readonly state = this.controller.state;
  readonly busy = this.controller.busy;
  readonly error = this.controller.error;
  readonly prepared = this.controller.prepared;
  readonly answer = this.controller.answer;
  readonly delivery = this.controller.delivery;
  readonly confirmation = this.controller.confirmation;
  readonly subject = this.controller.subject;
  readonly body = this.controller.body;
  readonly question = this.controller.question;
  readonly canPrepare = this.controller.canPrepare;
  readonly workspaceNavigation = computed(
    () => new AssistantContextNavigation(this.controller.snapshot())
  );
  private initialized = false;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platform)) return;
    this.initialized = true;
    const navigation =
      this.router.currentNavigation() ?? this.router.lastSuccessfulNavigation();
    const info = navigation?.extras.info;
    void this.load(
      !this.showWorkspaceLink() && info instanceof AssistantContextNavigation
        ? info.take()
        : null
    );
  }

  ngOnChanges(): void {
    if (this.initialized) void this.load();
  }

  load(snapshot: AssistantContextSnapshot | null = null): Promise<void> {
    return this.controller.load(snapshot);
  }

  prepare(type: AdminAssistantDraftType): Promise<void> {
    return this.controller.prepare(type);
  }

  reviewSend(): void {
    this.controller.reviewSend();
  }

  cancelSend(): void {
    this.controller.cancelSend();
  }

  send(): Promise<void> {
    return this.controller.send();
  }

  ask(): Promise<void> {
    return this.controller.ask();
  }
}
