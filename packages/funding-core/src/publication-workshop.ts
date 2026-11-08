/** Private publication preparation. No field in this contract authorizes delivery. */
export interface WorkshopEditorialPreparation {
  readonly schemaVersion: '1.0';
  readonly sourceVersion: number;
  readonly sourceCommitmentId: string;
  readonly sourceSnapshotDigest: string;
  readonly commitmentVersion: number;
  readonly state: 'partial' | 'ready_for_review';
  readonly publicationAuthorized: false;
  readonly common: {
    readonly version: number;
    readonly title: string;
    readonly presentation: string;
    readonly recognition: string;
    readonly sourceFacts: readonly {
      readonly key: string;
      readonly value: string;
    }[];
    readonly mediaReferences: readonly {
      readonly id: string;
      readonly publicUseAllowed: true;
    }[];
    readonly missingInformation: readonly string[];
  };
  readonly variants: readonly {
    readonly destination: 'website' | 'facebook';
    readonly obligationId: string;
    readonly obligationVersion: number;
    readonly version: number;
    readonly title: string;
    readonly body: string;
    readonly summary: string;
    readonly format: 'individual' | 'collective';
    readonly mediaReferences: readonly {
      readonly id: string;
      readonly publicUseAllowed: true;
    }[];
    readonly publicationAuthorized: false;
  }[];
}

export interface WorkshopProposal {
  readonly id: string;
  readonly missionId: string;
  readonly sourceVersion: number;
  readonly version: number;
  readonly createdAt: string;
  readonly obsolete: boolean;
  readonly provenance: {
    readonly simulated: boolean;
    readonly provider: string;
    readonly model: string;
  };
  readonly editorialPreparation: WorkshopEditorialPreparation;
  readonly adoptedAt: string | null;
}

export interface PublicationWorkshopState {
  readonly contributionId: string;
  readonly enabled: boolean;
  readonly sourceVersion: number | null;
  readonly sourceSnapshotDigest: string | null;
  readonly mission: {
    readonly id: string;
    readonly status: string;
    readonly delivery:
      'queued' | 'sending' | 'acknowledged' | 'uncertain' | 'failed';
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly errorCode: string | null;
  } | null;
  readonly proposal: WorkshopProposal | null;
  readonly history: readonly WorkshopProposal[];
  readonly canPrepare: boolean;
  readonly canAdopt: boolean;
}

export interface PublicationWorkshopPrepareRequest {
  readonly contributionId: string;
  readonly expectedSourceVersion: number | null;
  readonly requestId: string;
}

export interface PublicationWorkshopAdoptRequest {
  readonly contributionId: string;
  readonly proposalId: string;
  readonly expectedSourceVersion: number;
  readonly requestId: string;
}
