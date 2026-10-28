import {
  Injectable,
  TemplateRef,
  computed,
  inject,
  signal
} from '@angular/core';

import { FundingI18nService } from '../services/funding-i18n.service.js';

import en from './i18n/service-demo.en.json' with { type: 'json' };
import fr from './i18n/service-demo.fr-CA.json' with { type: 'json' };
import editorEn from './i18n/service-demo-editor.en.json' with { type: 'json' };
import editorFr from './i18n/service-demo-editor.fr-CA.json' with { type: 'json' };
import detailEn from './i18n/service-demo-detail.en.json' with { type: 'json' };
import detailFr from './i18n/service-demo-detail.fr-CA.json' with { type: 'json' };
import navigationEn from './i18n/service-demo-navigation.en.json' with { type: 'json' };
import navigationFr from './i18n/service-demo-navigation.fr-CA.json' with { type: 'json' };
import { DEMO_DOSSIERS } from './service-demo-fixtures.js';

export { DEMO_DOSSIERS };

export interface ServiceDemoContent {
  readonly text: string;
  readonly textEdited: boolean;
  readonly mention: string;
  readonly showLink: boolean;
  readonly link: string;
  readonly imageIncluded: boolean;
  readonly imageAsset: 'panorama' | 'companion';
  readonly imageAlt: string;
}

interface ServiceDemoDraft extends ServiceDemoContent {
  readonly note: string;
  readonly comment: string;
  readonly commentDraft: string;
  readonly proofName: string;
  readonly proofNote: string;
  readonly saved: boolean;
  readonly dirty: boolean;
  readonly schedule: string;
  readonly timeZone: string;
  readonly recipient: string;
  readonly reconciliationReference: string;
  readonly reconciliationLink: string;
  readonly absenceReason: string;
}

/** Presentation state only. Never connects to administrative or payment services. */
@Injectable()
export class ServiceDemoState {
  private readonly drafts = signal<ReadonlyMap<string, ServiceDemoDraft>>(
    new Map()
  );
  private readonly savedVersions = signal<
    ReadonlyMap<string, ServiceDemoContent>
  >(new Map());
  readonly actions = signal<TemplateRef<unknown> | null>(null);
  readonly i18n = inject(FundingI18nService);
  readonly language = this.i18n.currentLanguage;
  readonly currentId = signal<string>('atelier-boreal');
  readonly dossier = computed(
    () =>
      DEMO_DOSSIERS.find((item) => item.id === this.currentId()) ??
      DEMO_DOSSIERS[0]
  );
  readonly text = signal('');
  readonly textEdited = signal(false);
  readonly mention = signal('');
  readonly showLink = signal(true);
  readonly link = signal('https://example.com/atelier-boreal');
  readonly note = signal('');
  readonly comment = signal('');
  readonly commentDraft = signal('');
  readonly proofName = signal('');
  readonly proofNote = signal('');
  readonly reconciliationReference = signal('');
  readonly reconciliationLink = signal('');
  readonly absenceReason = signal('');
  readonly saved = signal(false);
  readonly dirty = signal(false);
  readonly imageIncluded = signal(true);
  readonly imageAsset = signal<'panorama' | 'companion'>('panorama');
  readonly imageAlt = signal('');
  readonly previewMode = signal<'standard' | 'compact'>('standard');
  readonly previewImage = computed(() =>
    this.imageAsset() === 'companion'
      ? 'assets/admin-guide-princess-lion.webp'
      : 'assets/admin-guide-panorama.webp'
  );
  readonly savedContent = computed(() =>
    this.savedVersions().get(this.currentId())
  );
  readonly canRestoreDraft = computed(() => {
    const saved = this.savedContent();
    if (!saved) return false;
    const current = this.contentSnapshot();
    return (Object.keys(saved) as (keyof ServiceDemoContent)[]).some(
      (key) => key !== 'textEdited' && saved[key] !== current[key]
    );
  });
  readonly query = signal('');
  readonly filter = signal('all');
  readonly returnTo = signal<string | null>(null);
  readonly listParams = computed(() => ({
    q: this.query() || null,
    etat: this.filter() === 'all' ? null : this.filter(),
    ...(this.returnTo() ? { returnTo: this.returnTo() } : {})
  }));
  readonly page = signal('');
  readonly editorTab = signal('texte');
  readonly schedule = signal('2026-10-28T10:00');
  readonly timeZone = signal('America/Toronto');
  readonly recipient = signal('contact@example.test');
  readonly draftIds = computed<readonly string[]>(() => {
    const drafts = new Map(this.drafts());
    drafts.set(this.currentId(), this.snapshot());
    return [...drafts]
      .filter(
        ([, draft]) =>
          draft.dirty ||
          draft.saved ||
          draft.textEdited ||
          draft.note ||
          draft.comment ||
          draft.commentDraft ||
          draft.proofName ||
          draft.proofNote ||
          draft.reconciliationReference ||
          draft.reconciliationLink ||
          draft.absenceReason
      )
      .map(([id]) => id);
  });
  readonly hasLocalWork = computed(() => this.draftIds().length > 0);
  readonly previewOrigin = computed(() =>
    this.page() === 'corriger' ? `corriger/${this.editorTab()}` : this.page()
  );

  constructor() {
    this.i18n.mergeTranslations('fr-CA', fr);
    this.i18n.mergeTranslations('en', en);
    this.i18n.mergeTranslations('fr-CA', editorFr);
    this.i18n.mergeTranslations('en', editorEn);
    this.i18n.mergeTranslations('fr-CA', detailFr);
    this.i18n.mergeTranslations('en', detailEn);
    this.i18n.mergeTranslations('fr-CA', navigationFr);
    this.i18n.mergeTranslations('en', navigationEn);
  }

  t(key: string): string {
    return this.i18n.t(key);
  }

  href(page = ''): string {
    return `/demo/prestations/dossier/${encodeURIComponent(this.currentId())}${page ? '/' + page : ''}`;
  }

  selectDossier(id: string): void {
    if (
      id === this.currentId() ||
      !DEMO_DOSSIERS.some((dossier) => dossier.id === id)
    )
      return;
    const drafts = new Map(this.drafts());
    drafts.set(this.currentId(), this.snapshot());
    this.drafts.set(drafts);
    const draft = drafts.get(id);
    this.currentId.set(id);
    this.applyDraft(id, draft);
  }

  /** Clear only this synthetic visit after a confirmed, completed departure. */
  clearLocalWork(): void {
    this.drafts.set(new Map());
    this.savedVersions.set(new Map());
    this.applyDraft(this.currentId());
    this.query.set('');
    this.filter.set('all');
    this.returnTo.set(null);
    this.previewMode.set('standard');
  }

  private applyDraft(id: string, draft?: ServiceDemoDraft): void {
    this.text.set(draft?.text ?? '');
    this.textEdited.set(draft?.textEdited ?? false);
    this.mention.set(draft?.mention ?? '');
    this.showLink.set(draft?.showLink ?? true);
    this.note.set(draft?.note ?? '');
    this.comment.set(draft?.comment ?? '');
    this.commentDraft.set(draft?.commentDraft ?? '');
    this.proofName.set(draft?.proofName ?? '');
    this.proofNote.set(draft?.proofNote ?? '');
    this.reconciliationReference.set(draft?.reconciliationReference ?? '');
    this.reconciliationLink.set(draft?.reconciliationLink ?? '');
    this.absenceReason.set(draft?.absenceReason ?? '');
    this.recipient.set(draft?.recipient ?? 'contact@example.test');
    this.schedule.set(draft?.schedule ?? '2026-10-28T10:00');
    this.timeZone.set(draft?.timeZone ?? 'America/Toronto');
    this.link.set(
      draft?.link ?? 'https://example.com/' + encodeURIComponent(id)
    );
    this.imageIncluded.set(draft?.imageIncluded ?? true);
    this.imageAsset.set(draft?.imageAsset ?? 'panorama');
    this.imageAlt.set(draft?.imageAlt ?? '');
    this.saved.set(draft?.saved ?? false);
    this.dirty.set(draft?.dirty ?? false);
  }

  markEdited(): void {
    this.dirty.set(true);
    this.saved.set(false);
  }

  saveDraft(): void {
    if (!this.text() && !this.textEdited())
      this.text.set(
        this.i18n.t('serviceDemo.preview.text', { name: this.dossier().name })
      );
    const savedVersions = new Map(this.savedVersions());
    savedVersions.set(this.currentId(), this.contentSnapshot());
    this.savedVersions.set(savedVersions);
    this.saved.set(true);
    this.dirty.set(false);
  }

  restoreSavedDraft(): void {
    const saved = this.savedContent();
    if (!saved) return;
    this.text.set(saved.text);
    this.textEdited.set(saved.textEdited);
    this.mention.set(saved.mention);
    this.showLink.set(saved.showLink);
    this.link.set(saved.link);
    this.imageIncluded.set(saved.imageIncluded);
    this.imageAsset.set(saved.imageAsset);
    this.imageAlt.set(saved.imageAlt);
    this.saved.set(true);
    this.dirty.set(false);
  }

  private contentSnapshot(): ServiceDemoContent {
    return {
      text: this.text(),
      textEdited: this.textEdited(),
      mention: this.mention(),
      showLink: this.showLink(),
      link: this.link(),
      imageIncluded: this.imageIncluded(),
      imageAsset: this.imageAsset(),
      imageAlt: this.imageAlt()
    };
  }

  private snapshot(): ServiceDemoDraft {
    return {
      ...this.contentSnapshot(),
      note: this.note(),
      comment: this.comment(),
      commentDraft: this.commentDraft(),
      proofName: this.proofName(),
      proofNote: this.proofNote(),
      saved: this.saved(),
      dirty: this.dirty(),
      schedule: this.schedule(),
      timeZone: this.timeZone(),
      recipient: this.recipient(),
      reconciliationReference: this.reconciliationReference(),
      reconciliationLink: this.reconciliationLink(),
      absenceReason: this.absenceReason()
    };
  }
}
