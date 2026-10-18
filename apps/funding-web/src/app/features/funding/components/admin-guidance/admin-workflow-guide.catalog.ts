export interface AdminWorkflowGuideStep {
  readonly id: string;
  /** Fixed reading landmarks only, never selectors or commands from a URL. */
  readonly targets: readonly string[];
}

export interface AdminWorkflowGuideJourney {
  readonly id: string;
  readonly steps: readonly AdminWorkflowGuideStep[];
}

/** The existing screens are the reference; this catalogue never executes their actions. */
export const ADMIN_WORKFLOW_GUIDE_JOURNEYS: readonly AdminWorkflowGuideJourney[] =
  [
    {
      id: 'agreement',
      steps: [
        { id: 'pilot', targets: ['preparation-pilot'] },
        {
          id: 'source',
          targets: ['assistance-source-form', 'assistance-source-view']
        },
        { id: 'proposal', targets: ['assistance-suggestion'] },
        { id: 'qualification', targets: ['commitments-qualification'] },
        {
          id: 'confirm',
          targets: ['commitments-qualify', 'commitments-confirmation']
        }
      ]
    },
    {
      id: 'preparation',
      steps: [
        { id: 'obligations', targets: ['publication-obligations'] },
        { id: 'prepare', targets: ['publication-prepare'] },
        { id: 'draft', targets: ['publication-channel'] }
      ]
    },
    {
      id: 'authorization',
      steps: [
        { id: 'review', targets: ['publication-review'] },
        { id: 'content', targets: ['publication-channel'] },
        { id: 'schedule', targets: ['publication-next-slot'] },
        { id: 'authorize', targets: ['publication-review'] }
      ]
    },
    {
      id: 'delivery',
      steps: [
        { id: 'status', targets: ['publication-channel'] },
        { id: 'responsibility', targets: ['publication-obligations'] },
        { id: 'evidence', targets: ['publication-obligation-proof'] }
      ]
    },
    {
      id: 'website',
      steps: [
        {
          id: 'presentation',
          targets: ['publication-public-address', 'publication-public-summary']
        },
        { id: 'preview', targets: ['publication-public-preview'] },
        { id: 'visibility', targets: ['publication-website'] }
      ]
    },
    {
      id: 'history',
      steps: [
        {
          id: 'tracking',
          targets: ['publication-historical-declaration-help']
        },
        {
          id: 'declare',
          targets: [
            'publication-manual-status',
            'publication-manual-link',
            'publication-manual-notes'
          ]
        },
        { id: 'save', targets: ['publication-tracking-save'] }
      ]
    }
  ];
