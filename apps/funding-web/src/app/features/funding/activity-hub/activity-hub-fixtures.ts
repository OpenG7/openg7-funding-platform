export type HubCategory = 'journal' | 'inspirations' | 'news' | 'resources';
export type HubTheme = 'community' | 'product' | 'practice';

export interface HubEntry {
  readonly id: string;
  readonly category: HubCategory;
  readonly theme: HubTheme;
  readonly date: string;
  readonly minutes: number;
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly bodyKey: string;
  readonly authorKey: string;
  readonly featured?: boolean;
  readonly afterRefresh?: boolean;
}

/** Reading guides illustrated on the synthetic Discover dashboard. */
export const HUB_GUIDE_ENTRIES: readonly HubEntry[] = [
  ...(['exceptions', 'context', 'human', 'services'] as const).map(
    (guide, index) => ({
      id: `guide-${guide}`,
      category: 'resources' as const,
      theme:
        index === 1 || index === 3
          ? ('product' as const)
          : ('practice' as const),
      date: '2026-10-28',
      minutes: [4, 3, 5, 2][index],
      titleKey: `activityHub.guide.resourceCards.${guide}.title`,
      summaryKey: `activityHub.guide.resourceCards.${guide}.copy`,
      bodyKey: `activityHub.guide.resourceCards.${guide}.body`,
      authorKey: 'activityHub.authors.editorial'
    })
  )
];

/** Fixed, synthetic editorial examples. No item describes a real admin event. */
export const HUB_ENTRIES: readonly HubEntry[] = [
  {
    id: 'shared-workshop',
    category: 'inspirations',
    theme: 'community',
    date: '2026-10-28',
    minutes: 4,
    titleKey: 'activityHub.entries.sharedWorkshop.title',
    summaryKey: 'activityHub.entries.sharedWorkshop.summary',
    bodyKey: 'activityHub.entries.sharedWorkshop.body',
    authorKey: 'activityHub.authors.community',
    featured: true
  },
  {
    id: 'weekly-roundup',
    category: 'journal',
    theme: 'community',
    date: '2026-10-28',
    minutes: 3,
    titleKey: 'activityHub.entries.weeklyRoundup.title',
    summaryKey: 'activityHub.entries.weeklyRoundup.summary',
    bodyKey: 'activityHub.entries.weeklyRoundup.body',
    authorKey: 'activityHub.authors.editorial'
  },
  {
    id: 'clearer-navigation',
    category: 'news',
    theme: 'product',
    date: '2026-10-28',
    minutes: 2,
    titleKey: 'activityHub.entries.clearerNavigation.title',
    summaryKey: 'activityHub.entries.clearerNavigation.summary',
    bodyKey: 'activityHub.entries.clearerNavigation.body',
    authorKey: 'activityHub.authors.product'
  },
  {
    id: 'keyboard-paths',
    category: 'resources',
    theme: 'practice',
    date: '2026-10-27',
    minutes: 5,
    titleKey: 'activityHub.entries.keyboardPaths.title',
    summaryKey: 'activityHub.entries.keyboardPaths.summary',
    bodyKey: 'activityHub.entries.keyboardPaths.body',
    authorKey: 'activityHub.authors.editorial'
  },
  {
    id: 'listening-notes',
    category: 'journal',
    theme: 'community',
    date: '2026-10-27',
    minutes: 3,
    titleKey: 'activityHub.entries.listeningNotes.title',
    summaryKey: 'activityHub.entries.listeningNotes.summary',
    bodyKey: 'activityHub.entries.listeningNotes.body',
    authorKey: 'activityHub.authors.community'
  },
  {
    id: 'idea-library',
    category: 'inspirations',
    theme: 'practice',
    date: '2026-10-27',
    minutes: 4,
    titleKey: 'activityHub.entries.ideaLibrary.title',
    summaryKey: 'activityHub.entries.ideaLibrary.summary',
    bodyKey: 'activityHub.entries.ideaLibrary.body',
    authorKey: 'activityHub.authors.editorial'
  },
  {
    id: 'short-briefings',
    category: 'resources',
    theme: 'practice',
    date: '2026-10-27',
    minutes: 3,
    titleKey: 'activityHub.entries.shortBriefings.title',
    summaryKey: 'activityHub.entries.shortBriefings.summary',
    bodyKey: 'activityHub.entries.shortBriefings.body',
    authorKey: 'activityHub.authors.editorial'
  },
  {
    id: 'demo-preview',
    category: 'news',
    theme: 'product',
    date: '2026-10-26',
    minutes: 2,
    titleKey: 'activityHub.entries.demoPreview.title',
    summaryKey: 'activityHub.entries.demoPreview.summary',
    bodyKey: 'activityHub.entries.demoPreview.body',
    authorKey: 'activityHub.authors.product'
  },
  {
    id: 'field-notebook',
    category: 'journal',
    theme: 'practice',
    date: '2026-10-26',
    minutes: 3,
    titleKey: 'activityHub.entries.fieldNotebook.title',
    summaryKey: 'activityHub.entries.fieldNotebook.summary',
    bodyKey: 'activityHub.entries.fieldNotebook.body',
    authorKey: 'activityHub.authors.editorial'
  },
  {
    id: 'accessible-stories',
    category: 'inspirations',
    theme: 'community',
    date: '2026-10-26',
    minutes: 4,
    titleKey: 'activityHub.entries.accessibleStories.title',
    summaryKey: 'activityHub.entries.accessibleStories.summary',
    bodyKey: 'activityHub.entries.accessibleStories.body',
    authorKey: 'activityHub.authors.community'
  },
  {
    id: 'community-questions',
    category: 'journal',
    theme: 'community',
    date: '2026-10-28',
    minutes: 2,
    titleKey: 'activityHub.entries.communityQuestions.title',
    summaryKey: 'activityHub.entries.communityQuestions.summary',
    bodyKey: 'activityHub.entries.communityQuestions.body',
    authorKey: 'activityHub.authors.community',
    afterRefresh: true
  },
  {
    id: 'reading-checklist',
    category: 'resources',
    theme: 'practice',
    date: '2026-10-28',
    minutes: 3,
    titleKey: 'activityHub.entries.readingChecklist.title',
    summaryKey: 'activityHub.entries.readingChecklist.summary',
    bodyKey: 'activityHub.entries.readingChecklist.body',
    authorKey: 'activityHub.authors.editorial',
    afterRefresh: true
  }
];
