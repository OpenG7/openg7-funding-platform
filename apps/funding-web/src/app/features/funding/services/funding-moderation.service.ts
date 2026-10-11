import { Injectable, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import type {
  ModerationDecisionInput,
  ModerationLevel,
  ModerationSubject
} from '@openg7/funding-core';

export interface ModerationRequest {
  subject: ModerationSubject;
  level: ModerationLevel;
  initial?: {
    internalReason?: string;
    sponsorExplanation?: string;
    requireExplanation?: boolean;
  };
}

/** Collects one explicit decision. Navigation cancels without persisting private drafts. */
@Injectable({ providedIn: 'root' })
export class FundingModerationService {
  readonly pending = signal<ModerationRequest | null>(null);
  private resolve: ((decision: ModerationDecisionInput | null) => void) | null =
    null;

  constructor() {
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) this.answer(null);
    });
  }

  requestDecision(
    subject: ModerationSubject,
    level: ModerationLevel,
    initial?: ModerationRequest['initial']
  ): Promise<ModerationDecisionInput | null> {
    if (this.pending()) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.pending.set({ subject, level, initial });
    });
  }

  answer(decision: ModerationDecisionInput | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.pending.set(null);
    resolve?.(decision);
  }
}
