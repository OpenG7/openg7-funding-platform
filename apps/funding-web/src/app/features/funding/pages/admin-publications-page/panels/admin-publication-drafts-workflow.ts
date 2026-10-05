import type { WritableSignal } from '@angular/core';
import type {
  AdminPublicationDraftRecord,
  AdminSponsorshipRecord,
  PublicationDraftStatus,
  SponsorFeedChannel
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../../services/funding-admin.service.js';
import {
  publicationDateTimeLocal,
  updatedPublicationDateTime
} from '../publication-panels.helpers.js';

export interface PublicationDraftEdit {
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
  readonly publicUrl: string;
  readonly scheduledAt: string;
  readonly reviewNote: string;
}

export interface AdminPublicationDraftsWorkflowPorts {
  readonly api: Pick<
    FundingAdminService,
    | 'createPublicationDraft'
    | 'updatePublicationDraft'
    | 'assignDraftToBatch'
    | 'unassignDraftFromBatch'
  >;
  readonly state: {
    readonly actionState: WritableSignal<string | null>;
    readonly draftEdits: WritableSignal<Record<string, PublicationDraftEdit>>;
    readonly dirtyDraftIds: WritableSignal<ReadonlySet<string>>;
    readonly showEligible: WritableSignal<boolean>;
    readonly selectedDraftId: WritableSignal<string | null>;
    readonly statusFilter: WritableSignal<
      'active' | 'all' | PublicationDraftStatus
    >;
  };
  token(): string;
  reload(): Promise<void>;
  confirm(action: 'refuse' | 'publish', target: string): Promise<boolean>;
  failed(): void;
  invalidDateTime?(): void;
  notice(key: string): void;
  focusRequested(id: string): void;
  batchSelection(id: string): string;
}

/** Manual draft mutations and reconciliation over the panel's explicit state. */
export class AdminPublicationDraftsWorkflow {
  constructor(private readonly ports: AdminPublicationDraftsWorkflowPorts) {}

  reconcileDrafts(drafts: readonly AdminPublicationDraftRecord[]): void {
    const { state } = this.ports;
    const existing = state.draftEdits();
    const dirtyIds = state.dirtyDraftIds();
    // A refresh can temporarily omit an edited record; keep its unsaved input.
    const edits = Object.fromEntries(
      Object.entries(existing).filter(([id]) => dirtyIds.has(id))
    );
    for (const draft of drafts) {
      edits[draft.id] = dirtyIds.has(draft.id)
        ? (existing[draft.id] ?? this.toEdit(draft))
        : this.toEdit(draft);
    }
    state.draftEdits.set(edits);
  }

  async createDraft(
    sponsorship: AdminSponsorshipRecord,
    channel: SponsorFeedChannel
  ): Promise<void> {
    const { state } = this.ports;
    if (!sponsorship.sponsor_feed_target || state.actionState()) return;
    state.actionState.set(sponsorship.id + channel);
    try {
      const result = await this.ports.api.createPublicationDraft(
        this.ports.token(),
        {
          contributionId: sponsorship.id,
          feedTarget: sponsorship.sponsor_feed_target,
          channel
        }
      );
      await this.ports.reload();
      if (result.draft) {
        state.showEligible.set(false);
        state.selectedDraftId.set(result.draft.id);
        state.statusFilter.set('all');
        this.ports.focusRequested(result.draft.id);
      }
    } catch {
      this.ports.failed();
    } finally {
      state.actionState.set(null);
    }
  }

  async saveDraft(
    draft: AdminPublicationDraftRecord,
    status?: PublicationDraftStatus
  ): Promise<void> {
    const { state } = this.ports;
    if (state.actionState()) return;
    if (
      status === 'rejected' &&
      !(await this.ports.confirm('refuse', draft.title))
    )
      return;
    if (
      status === 'published' &&
      !(await this.ports.confirm('publish', draft.title))
    )
      return;
    const edit = this.editFor(draft.id);
    state.actionState.set(draft.id);
    try {
      const result = await this.ports.api.updatePublicationDraft(
        this.ports.token(),
        {
          draftId: draft.id,
          title: edit.title,
          body: edit.body,
          disclosureText: edit.disclosureText,
          status,
          publicUrl: edit.publicUrl,
          scheduledAt: updatedPublicationDateTime(
            edit.scheduledAt,
            draft.scheduled_at
          ),
          reviewNote: edit.reviewNote
        }
      );
      if (!result.updated) throw new Error('Draft was not saved.');
      // Only clear the submitted revision; a newer edit still needs saving.
      if (this.editFor(draft.id) === edit) {
        state.dirtyDraftIds.update((ids) => {
          const next = new Set(ids);
          next.delete(draft.id);
          return next;
        });
      }
      this.ports.notice('admin.publications.saved');
      await this.ports.reload();
    } catch (error) {
      if (error instanceof RangeError && this.ports.invalidDateTime)
        this.ports.invalidDateTime();
      else this.ports.failed();
    } finally {
      state.actionState.set(null);
    }
  }

  async assignToBatch(draft: AdminPublicationDraftRecord): Promise<void> {
    const { state } = this.ports;
    const batchId = this.ports.batchSelection(draft.id);
    if (!batchId || state.actionState()) return;
    state.actionState.set(draft.id);
    try {
      await this.ports.api.assignDraftToBatch(this.ports.token(), {
        draftId: draft.id,
        batchId
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.actionState.set(null);
    }
  }

  async unassignFromBatch(draft: AdminPublicationDraftRecord): Promise<void> {
    const { state } = this.ports;
    if (state.actionState()) return;
    state.actionState.set(draft.id);
    try {
      await this.ports.api.unassignDraftFromBatch(this.ports.token(), {
        draftId: draft.id
      });
      await this.ports.reload();
    } catch {
      this.ports.failed();
    } finally {
      state.actionState.set(null);
    }
  }

  editFor(draftId: string): PublicationDraftEdit {
    return this.ports.state.draftEdits()[draftId] ?? this.emptyEdit();
  }

  emptyEdit(): PublicationDraftEdit {
    return {
      title: '',
      body: '',
      disclosureText: '',
      publicUrl: '',
      scheduledAt: '',
      reviewNote: ''
    };
  }

  private toEdit(draft: AdminPublicationDraftRecord): PublicationDraftEdit {
    return {
      title: draft.title,
      body: draft.body,
      disclosureText: draft.disclosure_text,
      publicUrl: draft.public_url ?? '',
      scheduledAt: publicationDateTimeLocal(draft.scheduled_at),
      reviewNote: draft.review_note ?? ''
    };
  }
}
