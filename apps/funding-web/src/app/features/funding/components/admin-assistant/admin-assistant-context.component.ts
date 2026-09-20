import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnChanges,
  OnInit,
  PLATFORM_ID,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminAssistantContextResponse,
  AdminAssistantDraftType,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryResponse,
  AdminInformationRequest,
  AdminInformationRequestResult
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import { AdminAssistantDraftComponent } from './admin-assistant-draft.component.js';
import { AdminAssistantAnswerComponent } from './admin-assistant-answer.component.js';

/** Funding organism: exact dossier loading and explicit human actions, independent of the model. */
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
  readonly dossierOpen = output<void>();
  readonly sponsorshipId = input<string>();
  readonly refreshKey = input<unknown>(0);
  readonly data = signal<AdminAssistantContextResponse | null>(null);
  readonly state = signal<'loading' | 'ready' | 'error' | 'forbidden'>(
    'loading'
  );
  readonly busy = signal(false);
  readonly error = signal('');
  readonly prepared = signal<AdminAssistantPrepareResponse | null>(null);
  readonly answer = signal<AdminAssistantQueryResponse | null>(null);
  readonly delivery = signal<AdminInformationRequestResult | null>(null);
  readonly confirmation = signal<AdminInformationRequest | null>(null);
  readonly subject = signal('');
  readonly body = signal('');
  readonly question = signal('');
  readonly dialog =
    viewChild<ElementRef<HTMLDialogElement>>('confirmationDialog');
  readonly router = inject(Router);
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly platform = inject(PLATFORM_ID);
  private readonly destroy = inject(DestroyRef);
  private generation = 0;
  private initialized = false;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platform)) return;
    this.initialized = true;
    void this.load();
  }
  ngOnChanges(): void {
    if (this.initialized) void this.load();
  }
  private current(generation: number): boolean {
    return generation === this.generation && !this.destroy.destroyed;
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.dialog()?.nativeElement.close();
    this.confirmation.set(null);
    this.data.set(null);
    this.prepared.set(null);
    this.answer.set(null);
    this.delivery.set(null);
    this.subject.set('');
    this.body.set('');
    this.question.set('');
    this.error.set('');
    this.busy.set(false);
    this.state.set('loading');
    try {
      if (!this.admin.hasValidAdminSession())
        throw new AdminDashboardRequestError(401);
      const data = await this.admin.getAssistantContext(
        this.admin.getSavedAdminToken(),
        this.sponsorshipId()
      );
      if (!this.current(generation)) return;
      this.data.set(data);
      this.state.set('ready');
    } catch (error) {
      if (this.current(generation)) {
        this.state.set('error');
        await this.handleError(error, false);
      }
    }
  }
  async prepare(type: AdminAssistantDraftType): Promise<void> {
    const context = this.data()?.context;
    if (!context || this.busy()) return;
    this.prepared.set(null);
    this.delivery.set(null);
    await this.act(async () => {
      const result = await this.admin.prepareAssistantDraft(
        this.admin.getSavedAdminToken(),
        {
          type,
          reference: context.contributionId,
          language: this.i18n.currentLanguage()
        }
      );
      return () => {
        this.prepared.set(result);
        this.subject.set(result.delivery?.subject ?? '');
        this.body.set(result.delivery?.body ?? '');
      };
    });
  }
  reviewSend(): void {
    const preview = this.prepared()?.delivery;
    if (
      !preview ||
      this.busy() ||
      !this.subject().trim() ||
      !this.body().trim()
    )
      return;
    this.confirmation.set({
      ...preview,
      subject: this.subject().trim(),
      body: this.body().trim(),
      confirmed: true
    });
    this.dialog()?.nativeElement.showModal();
  }
  cancelSend(): void {
    this.dialog()?.nativeElement.close();
    this.confirmation.set(null);
  }
  async send(): Promise<void> {
    const input = this.confirmation();
    if (!input || this.busy()) return;
    this.cancelSend();
    await this.act(async () => {
      const result = await this.admin.requestSponsorshipInformation(
        this.admin.getSavedAdminToken(),
        input
      );
      return () => {
        this.delivery.set(result);
        void this.admin.refreshWorkQueue();
        this.prepared.set(null);
        this.subject.set('');
        this.body.set('');
      };
    });
  }
  async ask(): Promise<void> {
    const context = this.data()?.context;
    if (
      !context ||
      !this.question().trim() ||
      this.busy() ||
      this.data()?.conversationMode === 'disabled'
    )
      return;
    this.answer.set(null);
    await this.act(async () => {
      const answer = await this.admin.queryAssistant(
        this.admin.getSavedAdminToken(),
        {
          message: this.question().trim(),
          sponsorshipId: context.contributionId
        }
      );
      return () => this.answer.set(answer);
    });
  }
  private async act(work: () => Promise<() => void>): Promise<void> {
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const apply = await work();
      if (this.current(generation)) apply();
    } catch (error) {
      if (this.current(generation)) await this.handleError(error);
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }
  private async handleError(error: unknown, action = true): Promise<void> {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : 0;
    if (status === 401 || status === 403) {
      this.data.set(null);
      this.prepared.set(null);
      this.answer.set(null);
      this.delivery.set(null);
      this.state.set('forbidden');
      if (status === 401) {
        this.admin.clearAdminSession();
        await this.router.navigate(['/admin/login'], {
          queryParams: { returnUrl: this.router.url }
        });
      }
    } else if (status === 409) {
      this.prepared.set(null);
      this.error.set('conflict');
    } else if (action) this.error.set('actionError');
  }
}
