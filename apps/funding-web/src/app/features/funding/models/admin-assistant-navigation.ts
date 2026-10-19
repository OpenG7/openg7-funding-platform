export {
  dossierReturn as assistantDossierReturn,
  dossierReturnQuery as assistantDossierQuery
} from './admin-dossier-return.js';

/** Transient focus intent for the two known Assistant links; never persisted. */
export class AssistantDossierNavigation {
  constructor(
    readonly sponsorshipId: string,
    readonly source: 'dossier' | 'shell'
  ) {}
}
