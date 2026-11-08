import { isDeepStrictEqual } from 'node:util';

import type {
  WorkshopEditorialPreparation,
  WorkshopProposal
} from '@openg7/funding-core';

import {
  record,
  text,
  integer,
  uuid,
  type RemoteMissionDetail
} from './contracts.js';
import { requireWorkshop } from './workshop-source.js';
import type { PreflightMission } from './contracts.js';

const bounded = (value: unknown, max: number): string => {
  requireWorkshop(
    typeof value === 'string' && value.length <= max && !value.includes('\0'),
    'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
    503
  );
  return value;
};
const array = (value: unknown, max = 100): unknown[] => {
  requireWorkshop(
    Array.isArray(value) && value.length <= max,
    'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
    503
  );
  return value;
};

/** Check structured results against the exact persisted request, never remote identity claims alone. */
export function projectWorkshopProposals(
  detail: RemoteMissionDetail,
  expected: PreflightMission
): WorkshopProposal[] {
  const context = record(expected.input.editorialContext);
  requireWorkshop(
    detail.mission.id === expected.missionId &&
      detail.mission.tenantId === expected.tenantId &&
      detail.mission.source.subjectId === expected.source.subjectId &&
      detail.mission.source.version === expected.source.version &&
      detail.mission.source.application === expected.source.application &&
      detail.mission.source.subjectType === expected.source.subjectType &&
      detail.mission.input.sourceSnapshotDigest ===
        expected.input.sourceSnapshotDigest &&
      isDeepStrictEqual(
        detail.mission.input.editorialContext,
        expected.input.editorialContext
      ),
    'PUBLICATION_WORKSHOP_RESPONSE_MISMATCH',
    503
  );
  const destinations = array(context.destinations).map(record);
  const proposals = detail.proposals.filter(
    (p) => p.editorialPreparation !== undefined
  );
  requireWorkshop(
    !['review_ready', 'completed'].includes(detail.mission.status) ||
      proposals.length > 0,
    'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
    503
  );
  return proposals.map((proposal) => {
    const prep = record(proposal.editorialPreparation),
      common = record(prep.common),
      provenance = record(proposal.provenance);
    const draft = detail.results.find(
      (result) =>
        result.id === proposal.draftResultId && result.kind === 'draft'
    );
    const checks = array(proposal.checks).map(record);
    const completeness = detail.results.find(
      (result) => result.kind === 'completeness'
    );
    const policy = detail.results.find(
      (result) => result.kind === 'preparation-policy'
    );
    const outputCheck = detail.results.find(
      (result) => result.kind === 'output-check'
    );
    requireWorkshop(
      proposal.tenantId === expected.tenantId &&
        proposal.missionId === expected.missionId &&
        isDeepStrictEqual(proposal.source, expected.source) &&
        draft &&
        !draft.obsolete &&
        isDeepStrictEqual(draft.provenance, provenance) &&
        provenance.inputVersion === expected.source.version &&
        completeness?.output.complete === true &&
        policy?.output.preparationOnly === true &&
        policy.output.humanReviewRequired === true &&
        policy.output.externalPublicationAllowed === false &&
        policy.output.businessDecisionAllowed === false &&
        outputCheck?.output.passed === true &&
        outputCheck.output.sourceVersion === expected.source.version &&
        ['completeness', 'preparation-policy', 'output-check'].every((kind) =>
          checks.some(
            (check) =>
              check.kind === kind &&
              check.passed === true &&
              detail.results.some(
                (result) =>
                  result.id === check.resultId &&
                  result.kind === kind &&
                  !result.obsolete
              )
          )
        ) &&
        proposal.authority === 'source_application' &&
        proposal.businessDecisionExecuted === false &&
        proposal.sourceVersion === expected.source.version &&
        prep.schemaVersion === '1.0' &&
        prep.sourceVersion === expected.source.version &&
        prep.sourceCommitmentId === context.sourceCommitmentId &&
        prep.sourceSnapshotDigest === context.sourceSnapshotDigest &&
        prep.commitmentVersion === context.commitmentVersion &&
        prep.publicationAuthorized === false &&
        ['partial', 'ready_for_review'].includes(String(prep.state)) &&
        typeof provenance.simulated === 'boolean' &&
        (provenance.provider !== 'mock' || provenance.simulated === true) &&
        common.version === 1,
      'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
      503
    );
    const variants = array(prep.variants).map((raw) => {
      const variant = record(raw);
      const destination = destinations.find(
        (d) => d.obligationId === variant.obligationId
      );
      requireWorkshop(
        destination &&
          destination.destination === variant.destination &&
          destination.obligationVersion === variant.obligationVersion &&
          destination.format === variant.format &&
          variant.publicationAuthorized === false &&
          variant.version === 1 &&
          array(variant.mediaReferences).length === 0,
        'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
        503
      );
      return {
        destination: destination.destination as 'website' | 'facebook',
        obligationId: uuid(variant.obligationId),
        obligationVersion: integer(variant.obligationVersion),
        version: integer(variant.version),
        title: bounded(variant.title, 160),
        body: bounded(
          variant.body,
          destination.destination === 'website' ? 20000 : 2500
        ),
        summary: bounded(variant.summary, 500),
        format: destination.format as 'individual' | 'collective',
        mediaReferences: [],
        publicationAuthorized: false as const
      };
    });
    requireWorkshop(
      new Set(variants.map((v) => v.obligationId)).size === variants.length &&
        variants.length === destinations.length &&
        array(common.mediaReferences).length === 0,
      'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
      503
    );
    const sourceFacts = array(common.sourceFacts).map((raw) => {
      const fact = record(raw);
      return { key: text(fact.key, 128), value: bounded(fact.value, 4000) };
    });
    requireWorkshop(
      JSON.stringify(sourceFacts) === JSON.stringify(context.sourceFacts),
      'PUBLICATION_WORKSHOP_RESPONSE_MISMATCH',
      503
    );
    const editorialPreparation: WorkshopEditorialPreparation = {
      schemaVersion: '1.0',
      sourceVersion: integer(prep.sourceVersion),
      sourceCommitmentId: uuid(prep.sourceCommitmentId),
      sourceSnapshotDigest: text(prep.sourceSnapshotDigest),
      commitmentVersion: integer(prep.commitmentVersion),
      state: prep.state as 'partial' | 'ready_for_review',
      publicationAuthorized: false,
      common: {
        version: integer(common.version),
        title: bounded(common.title, 160),
        presentation: bounded(common.presentation, 20000),
        recognition: bounded(common.recognition, 4000),
        sourceFacts,
        mediaReferences: [],
        missingInformation: array(common.missingInformation).map((v) =>
          text(v, 128)
        )
      },
      variants
    };
    requireWorkshop(
      array(context.missingInformation).every((code) =>
        editorialPreparation.common.missingInformation.includes(String(code))
      ) &&
        (editorialPreparation.state === 'ready_for_review') ===
          (editorialPreparation.common.missingInformation.length === 0),
      'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
      503
    );
    const identity = record(context.publicIdentity);
    if (identity.consent !== true || !identity.displayName) {
      requireWorkshop(
        editorialPreparation.state === 'partial' &&
          !editorialPreparation.common.presentation &&
          !editorialPreparation.common.recognition &&
          variants.every((v) => !v.body && !v.summary),
        'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
        503
      );
    }
    requireWorkshop(
      typeof proposal.createdAt === 'string' &&
        Number.isFinite(Date.parse(proposal.createdAt)),
      'PUBLICATION_WORKSHOP_RESPONSE_INVALID',
      503
    );
    return {
      id: proposal.id,
      missionId: proposal.missionId,
      sourceVersion: proposal.source.version,
      version: proposal.version,
      createdAt: new Date(proposal.createdAt).toISOString(),
      obsolete: proposal.status === 'obsolete',
      provenance: {
        simulated: provenance.simulated as boolean,
        provider: text(provenance.provider),
        model: text(provenance.model, 200)
      },
      editorialPreparation,
      adoptedAt: null
    };
  });
}
