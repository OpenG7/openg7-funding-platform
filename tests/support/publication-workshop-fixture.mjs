import { randomUUID } from 'node:crypto';

/** Synthetic remote response for Funding's trust-boundary and recovery tests. */
export function workshopRemoteDetail(mission) {
  const context = mission.input.editorialContext;
  const partial = context.missingInformation.length > 0;
  const publicIdentity =
    context.publicIdentity.consent && context.publicIdentity.displayName;
  const provenance = {
    provider: 'mock',
    model: 'synthetic-workshop',
    simulated: true,
    inputVersion: mission.source.version
  };
  const results = [
    'completeness',
    'preparation-policy',
    'draft',
    'output-check'
  ].map((kind) => ({
    id: randomUUID(),
    taskId: randomUUID(),
    kind,
    output:
      kind === 'completeness'
        ? { complete: true }
        : kind === 'preparation-policy'
          ? {
              preparationOnly: true,
              humanReviewRequired: true,
              externalPublicationAllowed: false,
              businessDecisionAllowed: false
            }
          : { passed: true, sourceVersion: mission.source.version },
    provenance,
    version: 1,
    obsolete: false
  }));
  const editorialPreparation = {
    schemaVersion: '1.0',
    sourceVersion: mission.source.version,
    sourceCommitmentId: context.sourceCommitmentId,
    sourceSnapshotDigest: context.sourceSnapshotDigest,
    commitmentVersion: context.commitmentVersion,
    state: partial ? 'partial' : 'ready_for_review',
    publicationAuthorized: false,
    common: {
      version: 1,
      title: publicIdentity
        ? 'Synthetic partner'
        : 'Préparation partielle de la commandite',
      presentation: publicIdentity ? 'Synthetic public presentation' : '',
      recognition: publicIdentity ? 'Synthetic acknowledgement' : '',
      sourceFacts: publicIdentity ? context.sourceFacts : [],
      mediaReferences: [],
      missingInformation: context.missingInformation
    },
    variants: context.destinations.map((destination) => ({
      ...destination,
      version: 1,
      title: 'Synthetic partner',
      body: publicIdentity
        ? 'Synthetic proposal for explicit human review'
        : '',
      summary: publicIdentity ? 'Synthetic proposed public summary' : '',
      mediaReferences: [],
      publicationAuthorized: false
    }))
  };
  const proposal = {
    id: randomUUID(),
    missionId: mission.missionId,
    tenantId: mission.tenantId,
    source: mission.source,
    status: 'prepared',
    version: 1,
    type: 'review',
    risk: 'normal',
    sourceVersion: mission.source.version,
    createdAt: new Date().toISOString(),
    draftResultId: results.find((r) => r.kind === 'draft').id,
    checks: results
      .filter((r) => r.kind !== 'draft')
      .map((r) => ({ resultId: r.id, kind: r.kind, passed: true })),
    provenance,
    authority: 'source_application',
    businessDecisionExecuted: false,
    editorialPreparation
  };
  return {
    mission: {
      id: mission.missionId,
      tenantId: mission.tenantId,
      source: mission.source,
      workflow: mission.workflow,
      status: 'review_ready',
      input: mission.input,
      revision: 1
    },
    results,
    proposals: [proposal]
  };
}
