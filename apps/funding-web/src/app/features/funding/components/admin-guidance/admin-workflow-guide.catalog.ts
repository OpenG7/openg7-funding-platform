export interface AdminWorkflowGuideStep {
  readonly id: string;
  /** Fixed reading landmarks only, never selectors or commands from a URL. */
  readonly targets: readonly string[];
}

export interface AdminWorkflowGuideJourney {
  readonly id: string;
  readonly dossierTab: 'overview' | 'publication' | 'media';
  readonly steps: readonly AdminWorkflowGuideStep[];
}

/** The existing screens are the reference; this catalogue never executes their actions. */
export const ADMIN_WORKFLOW_GUIDE_JOURNEYS: readonly AdminWorkflowGuideJourney[] =
  [
    {
      id: 'agreement',
      dossierTab: 'publication',
      steps: [
        { id: 'pilot', targets: ['admin-commitments'] },
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
      dossierTab: 'publication',
      steps: [
        { id: 'obligations', targets: ['publication-service'] },
        { id: 'prepare', targets: ['publication-monitor-next'] },
        { id: 'draft', targets: ['publication-service'] }
      ]
    },
    {
      id: 'authorization',
      dossierTab: 'publication',
      steps: [
        { id: 'review', targets: ['publication-service-action'] },
        { id: 'content', targets: ['publication-service'] },
        { id: 'schedule', targets: ['publication-service'] },
        { id: 'authorize', targets: ['publication-monitor-next'] }
      ]
    },
    {
      id: 'delivery',
      dossierTab: 'publication',
      steps: [
        { id: 'status', targets: ['publication-service'] },
        { id: 'responsibility', targets: ['publication-monitor-next'] },
        { id: 'evidence', targets: ['publication-delivery-progress'] }
      ]
    },
    {
      id: 'website',
      dossierTab: 'media',
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
      dossierTab: 'media',
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
